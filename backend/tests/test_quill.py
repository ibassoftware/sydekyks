"""Tests for Quill — AI proposal drafting/refinement parsing, PDF document build, the playbook
step-key invariant, the sale.order deep link, and (DB-backed) the metered refine turn that writes the
chat transcript + per-proposal token ledger."""

from app.services import mission_ai, usage_guard, vision_ai
from app.sydekyks.quill import extraction, pdf
from app.sydekyks.quill.playbook import PLAYBOOK_KEY, PLAYBOOK_KEY_REFINE, PLAYBOOK_STEPS


# --- Pure AI-parsing unit tests (no DB, no network) ------------------------------------------------

def test_generate_proposal_parses_and_defaults(monkeypatch):
    monkeypatch.setattr(
        vision_ai, "llm_completion",
        lambda *a, **k: (True, "ok",
                         {"html": "<h1>Proposal</h1><p>Body</p>", "title": "Acme rollout", "customer": "Acme"}, {}),
    )
    ok, _m, draft, _meta = extraction.generate_proposal(
        "v", "m", template_body="<h1>[title]</h1>", template_format="html", notes="rollout for acme",
    )
    assert ok and draft["html"].startswith("<h1>Proposal</h1>")
    assert draft["title"] == "Acme rollout" and draft["customer"] == "Acme"


def test_generate_proposal_propagates_ai_failure(monkeypatch):
    monkeypatch.setattr(vision_ai, "llm_completion", lambda *a, **k: (False, "engine down", None, {}))
    ok, msg, draft, _meta = extraction.generate_proposal("v", "m", template_body=None, template_format="html", notes="x")
    assert ok is False and draft is None


def test_refine_proposal_parses(monkeypatch):
    monkeypatch.setattr(
        vision_ai, "llm_completion",
        lambda *a, **k: (True, "ok",
                         {"reply": "Shortened it.", "html": "<p>Short.</p>", "changed_summary": "Shortened the intro"}, {}),
    )
    ok, _m, result, _meta = extraction.refine_proposal(
        "v", "m", current_html="<p>Long intro...</p>", message="shorten the intro",
        history=[{"role": "user", "content": "hi"}],
    )
    assert ok and result["html"] == "<p>Short.</p>"
    assert result["changed_summary"] == "Shortened the intro" and result["reply"] == "Shortened it."


def test_refine_proposal_defaults_on_sparse_response(monkeypatch):
    monkeypatch.setattr(vision_ai, "llm_completion", lambda *a, **k: (True, "ok", {"html": "<p>x</p>"}, {}))
    ok, _m, result, _meta = extraction.refine_proposal("v", "m", current_html="<p>y</p>", message="tweak")
    assert ok and result["reply"] == "Done." and result["changed_summary"] == "Revised the proposal"


def test_history_and_facts_formatting():
    assert extraction._fmt_facts({"Customer": "Acme", "Empty": None}) == "- Customer: Acme"
    assert extraction._fmt_facts({}) == "(none supplied)"
    hist = extraction._fmt_history([{"role": "user", "content": "make it formal"},
                                    {"role": "assistant", "content": "Done"}])
    assert "Rep: make it formal" in hist and "Quill: Done" in hist


# --- PDF document build (no native render — that path is exercised in manual E2E) -------------------

def test_build_document_wraps_fragment_with_title_and_accent():
    doc = pdf.build_document("<p>Hello</p>", title="My Proposal", page_size="Letter", accent="#123456")
    assert doc.startswith("<!DOCTYPE html>")
    assert "<p>Hello</p>" in doc and "My Proposal" in doc
    assert "#123456" in doc and "size: Letter" in doc


# --- Registry / playbook invariants ----------------------------------------------------------------

def test_playbook_steps_metadata_is_complete():
    keys = [s["key"] for s in PLAYBOOK_STEPS]
    assert keys == ["load_inputs", "ground_facts", "check_quota", "generate", "save"]
    for step in PLAYBOOK_STEPS:
        assert step["title"] and step["description"] and step["likely_failures"]


def test_both_playbooks_registered():
    from app.services.missions import PLAYBOOK_REGISTRY

    assert PLAYBOOK_KEY in PLAYBOOK_REGISTRY and PLAYBOOK_KEY_REFINE in PLAYBOOK_REGISTRY


def test_mission_generic_record_links_quotation():
    from app.services.gadget_links import mission_generic_record

    assert mission_generic_record({"odoo_sale_order_id": 12}) == ("sale.order", 12, "Open quotation in Odoo")
    assert mission_generic_record({"proposal_id": "abc"}) is None  # a plain draft carries no odoo id


# --- DB-backed: a refine turn writes the transcript + token counts ---------------------------------

def _seed_quill(db):
    from app.models.sydekyk import Sydekyk
    from app.models.tenant import Tenant
    from app.sydekyks.quill.models import QuillProposal

    tenant = Tenant(name="Acme", slug="acme")
    db.add(tenant)
    db.flush()
    quill = Sydekyk(tenant_id=None, name="Quill", slug="quill", tagline="t", description="d",
                    avatar_url="/x.png", system_prompt="p", model="gpt-4o-mini", temperature=0.4,
                    is_exclusive=False, is_published=True, workflow_enabled=True, playbook_key="quill.draft")
    db.add(quill)
    db.flush()
    proposal = QuillProposal(tenant_id=tenant.id, sydekyk_id=quill.id, title="Acme rollout",
                             content_html="<p>Long intro...</p>", created_by="rep@acme.test")
    db.add(proposal)
    db.commit()
    return tenant, quill, proposal


def test_refine_run_writes_chat_and_token_ledger(db, monkeypatch):
    from app.models.mission import Mission
    from app.sydekyks.quill import playbook
    from app.sydekyks.quill.models import QuillChatMessage, QuillProposal

    tenant, quill, proposal = _seed_quill(db)

    class _LLM:
        provider = "power_core"
        model = "gpt-4o-mini"
        litellm_model_alias = "gpt-4o-mini"

    monkeypatch.setattr(mission_ai, "get_llm", lambda *_a, **_k: (_LLM(), "vk", "gpt-4o-mini"))
    monkeypatch.setattr(usage_guard, "check_allowed", lambda *_a, **_k: (True, None))
    monkeypatch.setattr(mission_ai, "emit_usage", lambda *_a, **_k: None)  # avoid metering deps in the unit test
    monkeypatch.setattr(
        playbook.extraction, "refine_proposal",
        lambda *_a, **_k: (True, "ok",
                           {"reply": "Shortened it.", "html": "<p>Short.</p>", "changed_summary": "Shortened the intro"},
                           {"usage": {"prompt_tokens": 20, "completion_tokens": 10, "total_tokens": 30}, "cost_usd": 0.002}),
    )

    mission = Mission(tenant_id=tenant.id, user_id=None, sydekyk_id=quill.id, mode="workflow_run",
                      signal_type="manual", playbook_key="quill.refine", status="running",
                      trigger_context={"proposal_id": str(proposal.id), "message": "shorten the intro"})
    db.add(mission)
    db.commit()

    playbook.run_refine(db, mission)

    db.refresh(proposal)
    assert proposal.content_html == "<p>Short.</p>"
    assert mission.status == "succeeded"
    assert (mission.result_summary or {}).get("changed") == "Shortened the intro"

    rows = db.query(QuillChatMessage).filter(QuillChatMessage.proposal_id == proposal.id).order_by(QuillChatMessage.seq).all()
    assert [r.role for r in rows] == ["user", "assistant"]
    assert rows[0].content == "shorten the intro"
    assert rows[1].total_tokens == 30 and rows[1].completion_tokens == 10 and rows[1].cost_usd == 0.002


# --- DB-backed: proposal access scoping + tenant isolation -----------------------------------------

def _mk_tenant_user(db, tenant_name, tenant_slug, email, role, quill_id=None, can_use=False, can_configure=False):
    from app.models.tenant import Tenant
    from app.models.user import User
    from app.models.user_permission import UserSydekykPermission

    t = db.query(Tenant).filter(Tenant.slug == tenant_slug).first()
    if t is None:
        t = Tenant(name=tenant_name, slug=tenant_slug)
        db.add(t)
        db.flush()
    u = User(tenant_id=t.id, email=email, hashed_password="x", role=role)
    db.add(u)
    db.flush()
    if role == "hero" and quill_id is not None:
        db.add(UserSydekykPermission(user_id=u.id, sydekyk_id=quill_id, can_use=can_use, can_configure=can_configure))
        db.flush()
    return t, u


def test_proposal_access_scoping_and_tenant_isolation(db):
    from fastapi import HTTPException
    from app.models.sydekyk import Sydekyk
    from app.sydekyks.quill.models import QuillProposal
    from app.sydekyks.quill.router import _proposal_or_404

    quill = Sydekyk(tenant_id=None, name="Quill", slug="quill", tagline="t", description="d",
                    avatar_url="/x.png", system_prompt="p", model="gpt-4o-mini", temperature=0.4,
                    is_exclusive=False, is_published=True, workflow_enabled=True, playbook_key="quill.draft")
    db.add(quill)
    db.flush()

    tA, owner = _mk_tenant_user(db, "HQ A", "hq-a", "owner@a.test", "hero", quill.id, can_use=True)
    _, other = _mk_tenant_user(db, "HQ A", "hq-a", "other@a.test", "hero", quill.id, can_use=True)
    _, manager = _mk_tenant_user(db, "HQ A", "hq-a", "manager@a.test", "hero", quill.id, can_use=True, can_configure=True)
    _, cmdrA = _mk_tenant_user(db, "HQ A", "hq-a", "cmdr@a.test", "commander")
    _, cmdrB = _mk_tenant_user(db, "HQ B", "hq-b", "cmdr@b.test", "commander")

    p = QuillProposal(tenant_id=tA.id, sydekyk_id=quill.id, title="A deal",
                      content_html="<p>x</p>", created_by="owner@a.test")
    db.add(p)
    db.commit()

    # Owner (use-only) sees their own.
    assert _proposal_or_404(db, owner, quill.id, p.id).id == p.id
    # A manager (can_configure) and a commander see all proposals in the HQ.
    assert _proposal_or_404(db, manager, quill.id, p.id).id == p.id
    assert _proposal_or_404(db, cmdrA, quill.id, p.id).id == p.id
    # A different salesperson in the SAME HQ cannot touch someone else's proposal.
    for offender in (other, cmdrB):
        try:
            _proposal_or_404(db, offender, quill.id, p.id)
            raise AssertionError(f"{offender.email} should not access the proposal")
        except HTTPException as exc:
            assert exc.status_code == 404
