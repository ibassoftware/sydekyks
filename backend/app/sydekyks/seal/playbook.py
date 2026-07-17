"""Seal's playbooks — contract drafting, conversational refinement, and clause-level review.

Three playbook keys, all driven by queued Missions and observed through the shared Mission SSE
endpoint. All are metered the standard way (usage_guard pre-flight + emit_usage), so every token
flows through the shared UsageRecord ledger:

  - ``seal.draft``   — turn a template + the drafter's brief (+ optional grounded Odoo facts) into a
                       polished HTML contract.
  - ``seal.refine``  — the "Ask Seal" co-editing turn: rewrite the current contract HTML per the
                       drafter's instruction, and append the user + assistant turns to the chat store.
  - ``seal.review``  — read the contract clause-by-clause and store a fresh set of grounded risk
                       findings (the wow factor). Findings whose quoted clause can't be located are
                       dropped; the human accepts/rejects each — Seal never rewrites on its own.

Seal never sends anything to a customer — it drafts and de-risks. Odoo is entirely optional.
"""

import re
from datetime import datetime, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.crypto import decrypt_secret
from app.models.mission import Mission
from app.services import gadget_links, mission_ai, mission_events, odoo, odoo_crm, usage_guard
from app.services.missions import record_step, register_playbook

from app.sydekyks.seal import extraction
from app.sydekyks.seal.models import SealChatMessage, SealContract, SealReviewFinding, SealTemplate, SealTenantSettings

PLAYBOOK_KEY = "seal.draft"
PLAYBOOK_KEY_REFINE = "seal.refine"
PLAYBOOK_KEY_REVIEW = "seal.review"

PLAYBOOK_STEPS = [
    {"key": "load_inputs", "title": "Load the template & brief",
     "description": "Read the chosen template, the drafter's brief, and (optionally) the linked opportunity.",
     "likely_failures": "The contract or template was deleted."},
    {"key": "ground_facts", "title": "Pull grounded facts (optional)",
     "description": "If an Odoo opportunity is linked, read its party/amount facts to ground the draft.",
     "likely_failures": "None fatal — Seal drafts from the brief alone when Odoo isn't connected."},
    {"key": "check_quota", "title": "Check AI allowance",
     "description": "Confirm the tenant is within its monthly AI-token budget before spending tokens.",
     "likely_failures": "Monthly token allowance reached — try again after it resets."},
    {"key": "generate", "title": "Write the contract",
     "description": "AI writes (or revises) the contract as clean HTML, grounded in the supplied facts.",
     "likely_failures": "No AI engine configured, or the model returned an unusable response."},
    {"key": "save", "title": "Save the draft",
     "description": "Store the generated HTML on the contract for the drafter to edit and export.",
     "likely_failures": "None fatal."},
]

PLAYBOOK_STEPS_REVIEW = [
    {"key": "load_contract", "title": "Load the contract",
     "description": "Read the current contract text to review.",
     "likely_failures": "The contract was deleted, or is empty."},
    {"key": "load_guidelines", "title": "Load the review playbook",
     "description": "Read the tenant's review guidelines to ground the risk assessment.",
     "likely_failures": "None fatal — Seal applies standard best practice when none are set."},
    {"key": "check_quota", "title": "Check AI allowance",
     "description": "Confirm the tenant is within its monthly AI-token budget before spending tokens.",
     "likely_failures": "Monthly token allowance reached — try again after it resets."},
    {"key": "analyze", "title": "Review the clauses",
     "description": "AI reads the contract clause-by-clause and flags risky, one-sided, or missing clauses.",
     "likely_failures": "No AI engine configured, or the model returned an unusable response."},
    {"key": "save_findings", "title": "Save the findings",
     "description": "Store the grounded findings (dropping any whose quoted clause can't be located).",
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


def _contract(db, mission) -> SealContract | None:
    ctx = mission.trigger_context or {}
    cid = ctx.get("contract_id")
    if not cid:
        return None
    row = db.get(SealContract, cid)
    if row is None or row.tenant_id != mission.tenant_id:
        return None
    return row


def html_to_text(html: str) -> str:
    """A cheap HTML→text reduction for feeding the review model — strips tags, collapses whitespace."""
    if not html:
        return ""
    text = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", html, flags=re.I | re.S)
    text = re.sub(r"</(p|div|li|h[1-6]|tr|br)>", "\n", text, flags=re.I)
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"&nbsp;", " ", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n\n", text)
    return text.strip()


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
    counterparty = _rel(lead.get("partner_id")) or lead.get("partner_name") or lead.get("contact_name")
    facts = {
        "Opportunity": lead.get("name"),
        "Counterparty": counterparty,
        "Contact": lead.get("contact_name"),
        "Email": lead.get("email_from"),
        "Expected value": lead.get("expected_revenue"),
        "Currency": odoo_crm.currency_name(lead),
        "Salesperson": _rel(lead.get("user_id")),
    }
    return facts, counterparty


def run_draft(db: Session, mission: Mission) -> None:
    idx = 0
    ctx = mission.trigger_context or {}
    contract = _contract(db, mission)
    if contract is None:
        record_step(db, mission, idx, "load_inputs", "internal", "failed", error="Contract not found")
        _finish(db, mission, "failed", {}, "Contract not found", failure_category="validation")
        return

    template = None
    template_id = ctx.get("template_id")
    if template_id:
        template = db.get(SealTemplate, template_id)
    notes = ctx.get("notes") or ""
    record_step(db, mission, idx, "load_inputs", "internal", "succeeded",
                output={"template": bool(template), "has_notes": bool(notes)})
    idx += 1

    facts: dict = {}
    counterparty = contract.counterparty_name
    lead_id = ctx.get("odoo_lead_id") or contract.odoo_lead_id
    if lead_id:
        facts, grounded = _ground_facts(db, mission, int(lead_id))
        counterparty = grounded or counterparty
        contract.odoo_lead_id = int(lead_id)
    record_step(db, mission, idx, "ground_facts", "gadget_call" if lead_id else "internal", "succeeded",
                output={"grounded": bool(facts)})
    idx += 1

    llm, virtual_key, model_alias = mission_ai.get_llm(db, mission)
    if llm is None:
        record_step(db, mission, idx, "check_quota", "internal", "failed", error="No AI engine configured")
        _finish(db, mission, "failed", {"contract_id": str(contract.id)},
                "No AI engine configured for Seal — set one in AI Engine settings.", failure_category="setup")
        return
    allowed, deny = usage_guard.check_allowed(db, mission.tenant_id, mission.sydekyk_id, model_alias)
    if not allowed:
        record_step(db, mission, idx, "check_quota", "internal", "failed", error=deny)
        _finish(db, mission, "failed", {"contract_id": str(contract.id)}, deny, failure_category="quota")
        return
    record_step(db, mission, idx, "check_quota", "internal", "succeeded", output={"allowed": True})
    idx += 1

    # Prose deltas are safe provisional output. Publish them whether or not a browser is connected;
    # the bounded event transport makes a late subscriber/reconnect possible.
    def on_delta(text: str) -> None:
        mission_events.publish(mission.id, "output.delta", {"text": text})

    ok_ai, msg, draft, meta = extraction.generate_contract_stream(
        virtual_key, model_alias,
        template_body=(template.body if template else None),
        template_format=(template.format if template else "html"),
        notes=notes, facts=facts, on_delta=on_delta,
    )
    mission_ai.emit_usage(db, mission, llm, meta)
    if not ok_ai or draft is None or not draft.get("html"):
        record_step(db, mission, idx, "generate", "internal", "failed", error=msg)
        _finish(db, mission, "failed", {"contract_id": str(contract.id)},
                msg or "The AI engine returned an unusable response.", failure_category="external")
        return
    record_step(db, mission, idx, "generate", "internal", "succeeded", output={"chars": len(draft["html"])})
    idx += 1

    contract.content_html = draft["html"]
    if draft.get("title") and (not contract.title or contract.title == "Untitled contract"):
        contract.title = draft["title"][:255]
    if counterparty:
        contract.counterparty_name = counterparty[:255]
    contract.template_id = template.id if template else contract.template_id
    contract.mission_id = mission.id
    db.commit()
    record_step(db, mission, idx, "save", "internal", "succeeded", output={"contract_id": str(contract.id)})

    _finish(db, mission, "succeeded", {
        "contract_id": str(contract.id), "title": contract.title,
        "counterparty": contract.counterparty_name, "action": "drafted",
    })


def _next_seq(db, contract_id) -> int:
    cur = db.query(func.coalesce(func.max(SealChatMessage.seq), -1)).filter(
        SealChatMessage.contract_id == contract_id
    ).scalar()
    return int(cur) + 1


def run_refine(db: Session, mission: Mission) -> None:
    idx = 0
    ctx = mission.trigger_context or {}
    contract = _contract(db, mission)
    message = (ctx.get("message") or "").strip()
    if contract is None or not message:
        record_step(db, mission, idx, "load_inputs", "internal", "failed", error="Contract or message missing")
        _finish(db, mission, "failed", {}, "Contract or message missing", failure_category="validation")
        return

    history = [
        {"role": m.role, "content": m.content}
        for m in (
            db.query(SealChatMessage)
            .filter(SealChatMessage.contract_id == contract.id)
            .order_by(SealChatMessage.seq.asc())
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
        _finish(db, mission, "failed", {"contract_id": str(contract.id)},
                "No AI engine configured for Seal.", failure_category="setup")
        return
    allowed, deny = usage_guard.check_allowed(db, mission.tenant_id, mission.sydekyk_id, model_alias)
    if not allowed:
        record_step(db, mission, idx, "check_quota", "internal", "failed", error=deny)
        _finish(db, mission, "failed", {"contract_id": str(contract.id)}, deny, failure_category="quota")
        return
    record_step(db, mission, idx, "check_quota", "internal", "succeeded", output={"allowed": True})
    idx += 1

    ok_ai, msg, result, meta = extraction.refine_contract(
        virtual_key, model_alias, current_html=contract.content_html, message=message, history=history,
    )
    mission_ai.emit_usage(db, mission, llm, meta)
    if not ok_ai or result is None or not result.get("html"):
        record_step(db, mission, idx, "generate", "internal", "failed", error=msg)
        _finish(db, mission, "failed", {"contract_id": str(contract.id)},
                msg or "The AI engine returned an unusable response.", failure_category="external")
        return
    record_step(db, mission, idx, "generate", "internal", "succeeded", output={"changed": result["changed_summary"]})
    idx += 1

    usage = meta.get("usage") or {}
    seq = _next_seq(db, contract.id)
    db.add(SealChatMessage(
        tenant_id=mission.tenant_id, contract_id=contract.id, seq=seq, role="user",
        content=message, mission_id=mission.id, created_by=None,
    ))
    db.add(SealChatMessage(
        tenant_id=mission.tenant_id, contract_id=contract.id, seq=seq + 1, role="assistant",
        content=result["reply"], mission_id=mission.id,
        prompt_tokens=int(usage.get("prompt_tokens") or 0),
        completion_tokens=int(usage.get("completion_tokens") or 0),
        total_tokens=int(usage.get("total_tokens") or 0),
        cost_usd=float(meta.get("cost_usd") or 0.0),
    ))
    contract.content_html = result["html"]
    contract.updated_at = datetime.now(timezone.utc)
    db.commit()
    record_step(db, mission, idx, "save", "internal", "succeeded", output={"contract_id": str(contract.id)})

    _finish(db, mission, "succeeded", {
        "contract_id": str(contract.id), "title": contract.title,
        "action": "revised", "changed": result["changed_summary"],
    })


def run_review(db: Session, mission: Mission) -> None:
    idx = 0
    contract = _contract(db, mission)
    if contract is None or not (contract.content_html or "").strip():
        record_step(db, mission, idx, "load_contract", "internal", "failed", error="Contract missing or empty")
        _finish(db, mission, "failed", {}, "Contract missing or empty", failure_category="validation")
        return
    text = html_to_text(contract.content_html)
    record_step(db, mission, idx, "load_contract", "internal", "succeeded", output={"chars": len(text)})
    idx += 1

    settings = db.query(SealTenantSettings).filter(SealTenantSettings.tenant_id == mission.tenant_id).first()
    guidelines = settings.review_guidelines if settings else ""
    record_step(db, mission, idx, "load_guidelines", "internal", "succeeded", output={"has_guidelines": bool(guidelines)})
    idx += 1

    llm, virtual_key, model_alias = mission_ai.get_llm(db, mission)
    if llm is None:
        record_step(db, mission, idx, "check_quota", "internal", "failed", error="No AI engine configured")
        _finish(db, mission, "failed", {"contract_id": str(contract.id)},
                "No AI engine configured for Seal.", failure_category="setup")
        return
    allowed, deny = usage_guard.check_allowed(db, mission.tenant_id, mission.sydekyk_id, model_alias)
    if not allowed:
        record_step(db, mission, idx, "check_quota", "internal", "failed", error=deny)
        _finish(db, mission, "failed", {"contract_id": str(contract.id)}, deny, failure_category="quota")
        return
    record_step(db, mission, idx, "check_quota", "internal", "succeeded", output={"allowed": True})
    idx += 1

    ok_ai, msg, findings, meta = extraction.review_contract(
        virtual_key, model_alias, contract_text=text, guidelines=guidelines,
    )
    mission_ai.emit_usage(db, mission, llm, meta)
    if not ok_ai or findings is None:
        record_step(db, mission, idx, "analyze", "internal", "failed", error=msg)
        _finish(db, mission, "failed", {"contract_id": str(contract.id)},
                msg or "The AI engine returned an unusable response.", failure_category="external")
        return
    record_step(db, mission, idx, "analyze", "internal", "succeeded", output={"raw_findings": len(findings)})
    idx += 1

    # Ground each finding: a non-empty anchor must be locatable in the contract text; drop the rest.
    seq = (contract.review_seq or 0) + 1
    kept = 0
    high = 0
    for f in findings:
        anchor = f["clause_anchor"]
        if anchor and anchor not in text and anchor not in contract.content_html:
            continue
        db.add(SealReviewFinding(
            tenant_id=mission.tenant_id, contract_id=contract.id, review_seq=seq,
            clause_label=f["clause_label"], category=f["category"], severity=f["severity"],
            issue=f["issue"], rationale=f["rationale"], clause_anchor=anchor,
            suggested_redline=f["suggested_redline"], status="open", mission_id=mission.id,
        ))
        kept += 1
        if f["severity"] == "high":
            high += 1
    contract.review_seq = seq
    contract.updated_at = datetime.now(timezone.utc)
    db.commit()
    record_step(db, mission, idx, "save_findings", "internal", "succeeded", output={"kept": kept, "high": high})

    _finish(db, mission, "succeeded", {
        "contract_id": str(contract.id), "title": contract.title,
        "action": "reviewed", "findings": kept, "high": high,
    })


register_playbook(PLAYBOOK_KEY, run_draft)
register_playbook(PLAYBOOK_KEY_REFINE, run_refine)
register_playbook(PLAYBOOK_KEY_REVIEW, run_review)
