"""Quill's playbooks — proposal drafting + conversational refinement.

Two playbook keys, both driven by queued Missions and observed through the shared Mission SSE
endpoint. Both are metered the standard way (usage_guard pre-flight + emit_usage), so every token
flows through the shared UsageRecord ledger:

  - ``quill.draft``  — turn a template + the rep's notes (+ optional grounded Odoo opportunity facts)
                       into a polished HTML proposal.
  - ``quill.refine`` — the "Ask Quill" co-editing turn: rewrite the current proposal HTML per the
                       rep's instruction, and append the user + assistant turns to the chat store.

Quill never sends anything to a customer — it drafts. Odoo is entirely optional.
"""

from datetime import datetime, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.crypto import decrypt_secret
from app.models.mission import Mission
from app.services import gadget_links, mission_ai, mission_events, odoo, odoo_crm, usage_guard
from app.services.missions import record_step, register_playbook

from app.sydekyks.quill import extraction
from app.sydekyks.quill.models import QuillChatMessage, QuillProposal, QuillTemplate

PLAYBOOK_KEY = "quill.draft"
PLAYBOOK_KEY_REFINE = "quill.refine"

PLAYBOOK_STEPS = [
    {"key": "load_inputs", "title": "Load the template & notes",
     "description": "Read the chosen template, the rep's notes, and (optionally) the linked opportunity.",
     "likely_failures": "The proposal or template was deleted."},
    {"key": "ground_facts", "title": "Pull grounded facts (optional)",
     "description": "If an Odoo opportunity is linked, read its customer/amount facts to ground the draft.",
     "likely_failures": "None fatal — Quill drafts from notes alone when Odoo isn't connected."},
    {"key": "check_quota", "title": "Check AI allowance",
     "description": "Confirm the tenant is within its monthly AI-token budget before spending tokens.",
     "likely_failures": "Monthly token allowance reached — try again after it resets."},
    {"key": "generate", "title": "Write the proposal",
     "description": "AI writes (or revises) the proposal as clean HTML, grounded in the supplied facts.",
     "likely_failures": "No AI engine configured, or the model returned an unusable response."},
    {"key": "save", "title": "Save the draft",
     "description": "Store the generated HTML on the proposal for the rep to edit and export.",
     "likely_failures": "None fatal."},
]


def _finish(db, mission, status, summary, error=None, failure_category=None):
    mission.status = status
    mission.result_summary = summary
    mission.error_message = error
    mission.failure_category = failure_category if status == "failed" else None
    mission.completed_at = datetime.now(timezone.utc)
    db.commit()


def _rel(v):
    if isinstance(v, list) and len(v) > 1:
        return v[1]
    return None


def _proposal(db, mission) -> QuillProposal | None:
    ctx = mission.trigger_context or {}
    pid = ctx.get("proposal_id")
    if not pid:
        return None
    row = db.get(QuillProposal, pid)
    if row is None or row.tenant_id != mission.tenant_id:
        return None
    return row


def _ground_facts(db, mission, lead_id: int) -> tuple[dict, str | None]:
    """Best-effort read of the linked opportunity's authoritative facts. Never fatal."""
    link = gadget_links.find_assigned_link(db, tenant_id=mission.tenant_id, sydekyk_id=mission.sydekyk_id, role_key="erp")
    if link is None:
        return {}, None
    ok, _msg, client = odoo.connect(link.url, link.database, link.username, decrypt_secret(link.encrypted_secret))
    if not ok or client is None:
        return {}, None
    try:
        lead = odoo_crm.read_lead(client, int(lead_id))
    except odoo.OdooError:
        return {}, None
    if not lead:
        return {}, None
    customer = _rel(lead.get("partner_id")) or lead.get("partner_name") or lead.get("contact_name")
    facts = {
        "Opportunity": lead.get("name"),
        "Customer": customer,
        "Contact": lead.get("contact_name"),
        "Email": lead.get("email_from"),
        "Expected revenue": lead.get("expected_revenue"),
        "Currency": odoo_crm.currency_name(lead),
        "Stage": _rel(lead.get("stage_id")),
        "Salesperson": _rel(lead.get("user_id")),
    }
    return facts, customer


def run_draft(db: Session, mission: Mission) -> None:
    idx = 0
    ctx = mission.trigger_context or {}
    proposal = _proposal(db, mission)
    if proposal is None:
        record_step(db, mission, idx, "load_inputs", "internal", "failed", error="Proposal not found")
        _finish(db, mission, "failed", {}, "Proposal not found", failure_category="validation")
        return

    template = None
    template_id = ctx.get("template_id")
    if template_id:
        template = db.get(QuillTemplate, template_id)
    notes = ctx.get("notes") or ""
    record_step(db, mission, idx, "load_inputs", "internal", "succeeded",
                output={"template": bool(template), "has_notes": bool(notes)})
    idx += 1

    facts: dict = {}
    customer = proposal.customer_name
    lead_id = ctx.get("odoo_lead_id") or proposal.odoo_lead_id
    if lead_id:
        facts, grounded_customer = _ground_facts(db, mission, int(lead_id))
        customer = grounded_customer or customer
        proposal.odoo_lead_id = int(lead_id)
    record_step(db, mission, idx, "ground_facts", "gadget_call" if lead_id else "internal", "succeeded",
                output={"grounded": bool(facts)})
    idx += 1

    llm, virtual_key, model_alias = mission_ai.get_llm(db, mission)
    if llm is None:
        record_step(db, mission, idx, "check_quota", "internal", "failed", error="No AI engine configured")
        _finish(db, mission, "failed", {"proposal_id": str(proposal.id)},
                "No AI engine configured for Quill — set one in AI Engine settings.", failure_category="setup")
        return
    allowed, deny = usage_guard.check_allowed(db, mission.tenant_id, mission.sydekyk_id, model_alias)
    if not allowed:
        record_step(db, mission, idx, "check_quota", "internal", "failed", error=deny)
        _finish(db, mission, "failed", {"proposal_id": str(proposal.id)}, deny, failure_category="quota")
        return
    record_step(db, mission, idx, "check_quota", "internal", "succeeded", output={"allowed": True})
    idx += 1

    # Prose deltas are safe provisional output. Publish them whether or not a browser is connected;
    # the bounded event transport makes a late subscriber/reconnect possible.
    def on_delta(text: str) -> None:
        mission_events.publish(mission.id, "output.delta", {"text": text})

    ok_ai, msg, draft, meta = extraction.generate_proposal_stream(
        virtual_key, model_alias,
        template_body=(template.body if template else None),
        template_format=(template.format if template else "html"),
        notes=notes, facts=facts, on_delta=on_delta,
    )
    mission_ai.emit_usage(db, mission, llm, meta)
    if not ok_ai or draft is None or not draft.get("html"):
        record_step(db, mission, idx, "generate", "internal", "failed", error=msg)
        _finish(db, mission, "failed", {"proposal_id": str(proposal.id)},
                msg or "The AI engine returned an unusable response.", failure_category="external")
        return
    record_step(db, mission, idx, "generate", "internal", "succeeded", output={"chars": len(draft["html"])})
    idx += 1

    proposal.content_html = draft["html"]
    if draft.get("title") and (not proposal.title or proposal.title == "Untitled proposal"):
        proposal.title = draft["title"][:255]
    if customer:
        proposal.customer_name = customer[:255]
    proposal.template_id = template.id if template else proposal.template_id
    proposal.mission_id = mission.id
    db.commit()
    record_step(db, mission, idx, "save", "internal", "succeeded", output={"proposal_id": str(proposal.id)})

    _finish(db, mission, "succeeded", {
        "proposal_id": str(proposal.id), "title": proposal.title,
        "customer": proposal.customer_name, "action": "drafted",
    })


def _next_seq(db, proposal_id) -> int:
    cur = db.query(func.coalesce(func.max(QuillChatMessage.seq), -1)).filter(
        QuillChatMessage.proposal_id == proposal_id
    ).scalar()
    return int(cur) + 1


def run_refine(db: Session, mission: Mission) -> None:
    idx = 0
    ctx = mission.trigger_context or {}
    proposal = _proposal(db, mission)
    message = (ctx.get("message") or "").strip()
    if proposal is None or not message:
        record_step(db, mission, idx, "load_inputs", "internal", "failed", error="Proposal or message missing")
        _finish(db, mission, "failed", {}, "Proposal or message missing", failure_category="validation")
        return

    history = [
        {"role": m.role, "content": m.content}
        for m in (
            db.query(QuillChatMessage)
            .filter(QuillChatMessage.proposal_id == proposal.id)
            .order_by(QuillChatMessage.seq.asc())
            .all()
        )
    ]
    record_step(db, mission, idx, "load_inputs", "internal", "succeeded", output={"turns": len(history)})
    idx += 1
    record_step(db, mission, idx, "ground_facts", "internal", "succeeded", output={"grounded": False})
    idx += 1

    llm, virtual_key, model_alias = mission_ai.get_llm(db, mission)
    if llm is None:
        record_step(db, mission, idx, "check_quota", "internal", "failed", error="No AI engine configured")
        _finish(db, mission, "failed", {"proposal_id": str(proposal.id)},
                "No AI engine configured for Quill.", failure_category="setup")
        return
    allowed, deny = usage_guard.check_allowed(db, mission.tenant_id, mission.sydekyk_id, model_alias)
    if not allowed:
        record_step(db, mission, idx, "check_quota", "internal", "failed", error=deny)
        _finish(db, mission, "failed", {"proposal_id": str(proposal.id)}, deny, failure_category="quota")
        return
    record_step(db, mission, idx, "check_quota", "internal", "succeeded", output={"allowed": True})
    idx += 1

    ok_ai, msg, result, meta = extraction.refine_proposal(
        virtual_key, model_alias, current_html=proposal.content_html, message=message, history=history,
    )
    mission_ai.emit_usage(db, mission, llm, meta)
    if not ok_ai or result is None or not result.get("html"):
        record_step(db, mission, idx, "generate", "internal", "failed", error=msg)
        _finish(db, mission, "failed", {"proposal_id": str(proposal.id)},
                msg or "The AI engine returned an unusable response.", failure_category="external")
        return
    record_step(db, mission, idx, "generate", "internal", "succeeded", output={"changed": result["changed_summary"]})
    idx += 1

    usage = meta.get("usage") or {}
    seq = _next_seq(db, proposal.id)
    db.add(QuillChatMessage(
        tenant_id=mission.tenant_id, proposal_id=proposal.id, seq=seq, role="user",
        content=message, mission_id=mission.id, created_by=None,
    ))
    db.add(QuillChatMessage(
        tenant_id=mission.tenant_id, proposal_id=proposal.id, seq=seq + 1, role="assistant",
        content=result["reply"], mission_id=mission.id,
        prompt_tokens=int(usage.get("prompt_tokens") or 0),
        completion_tokens=int(usage.get("completion_tokens") or 0),
        total_tokens=int(usage.get("total_tokens") or 0),
        cost_usd=float(meta.get("cost_usd") or 0.0),
    ))
    proposal.content_html = result["html"]
    proposal.updated_at = datetime.now(timezone.utc)
    db.commit()
    record_step(db, mission, idx, "save", "internal", "succeeded", output={"proposal_id": str(proposal.id)})

    _finish(db, mission, "succeeded", {
        "proposal_id": str(proposal.id), "title": proposal.title,
        "action": "revised", "changed": result["changed_summary"],
    })


register_playbook(PLAYBOOK_KEY, run_draft)
register_playbook(PLAYBOOK_KEY_REFINE, run_refine)
