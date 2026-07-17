"""Tests for Seal — contract drafting/refinement/review parsing, the review taxonomy validation, the
PDF document build, playbook step-key invariants, the sign.request deep link, and (DB-backed) the
metered review turn that drops un-anchorable findings + the accept-redline anchor swap + ownership
scoping."""

from app.services import mission_ai, usage_guard, vision_ai
from app.sydekyks.seal import extraction, pdf
from app.sydekyks.seal.playbook import (
    PLAYBOOK_KEY,
    PLAYBOOK_KEY_REFINE,
    PLAYBOOK_KEY_REVIEW,
    PLAYBOOK_STEPS,
    PLAYBOOK_STEPS_REVIEW,
    html_to_text,
)


# --- Pure AI-parsing unit tests (no DB, no network) ------------------------------------------------

def test_generate_contract_streams_and_derives_title(monkeypatch):
    chunks = ["<h1>Mutual NDA</h1>", "<p>Between Acme and Beta…</p>"]

    def fake_stream(*_a, **_k):
        for c in chunks:
            yield {"type": "delta", "text": c}
        yield {"type": "done", "text": "".join(chunks), "meta": {"usage": None, "cost_usd": 0.0}}

    monkeypatch.setattr(vision_ai, "llm_stream", fake_stream)
    seen: list[str] = []
    ok, _m, draft, _meta = extraction.generate_contract_stream(
        "v", "m", template_body="<h1>[t]</h1>", template_format="html",
        notes="mutual nda with acme", on_delta=seen.append,
    )
    assert ok
    assert draft["html"] == "<h1>Mutual NDA</h1><p>Between Acme and Beta…</p>"
    assert draft["title"] == "Mutual NDA"   # derived from the leading <h1>, not a JSON field
    assert seen == chunks                    # every token chunk was forwarded live


def test_generate_contract_stream_propagates_error(monkeypatch):
    def fake_stream(*_a, **_k):
        yield {"type": "error", "ok": False,
               "msg": "Could not reach the LiteLLM proxy: timed out", "meta": {}}

    monkeypatch.setattr(vision_ai, "llm_stream", fake_stream)
    ok, msg, draft, _meta = extraction.generate_contract_stream(
        "v", "m", template_body=None, template_format="html", notes="x",
    )
    assert ok is False and draft is None and "timed out" in msg


def test_review_contract_validates_category_and_severity(monkeypatch):
    monkeypatch.setattr(
        vision_ai, "llm_completion",
        lambda *a, **k: (True, "ok", {"findings": [
            {"clause_label": "Liability", "category": "frobnicate", "severity": "critical",
             "issue": "uncapped", "rationale": "risk", "clause_anchor": "unlimited liability",
             "suggested_redline": "cap at fees"},
            {"clause_label": "Missing indemnity", "category": "missing_clause", "severity": "high",
             "issue": "none", "rationale": "x", "clause_anchor": "", "suggested_redline": "add one"},
        ]}, {}),
    )
    ok, _m, findings, _meta = extraction.review_contract("v", "m", contract_text="unlimited liability", guidelines="")
    assert ok and len(findings) == 2
    # Out-of-taxonomy category and severity are coerced to the safe defaults, never trusted.
    assert findings[0]["category"] == "other" and findings[0]["severity"] == "low"
    assert findings[1]["category"] == "missing_clause" and findings[1]["severity"] == "high"


def test_review_contract_propagates_ai_failure(monkeypatch):
    monkeypatch.setattr(vision_ai, "llm_completion", lambda *a, **k: (False, "engine down", None, {}))
    ok, _m, findings, _meta = extraction.review_contract("v", "m", contract_text="x", guidelines="")
    assert ok is False and findings is None


def test_html_to_text_strips_tags():
    assert "Clause one" in html_to_text("<h2>Clause one</h2><p>body</p>")
    assert "<" not in html_to_text("<p>a</p><p>b</p>")


# --- PDF document build ----------------------------------------------------------------------------

def test_build_document_wraps_fragment_with_title_and_accent():
    doc = pdf.build_document("<p>Hello</p>", title="My Contract", page_size="Letter", accent="#123456")
    assert doc.startswith("<!DOCTYPE html>")
    assert "<p>Hello</p>" in doc and "My Contract" in doc
    assert "#123456" in doc and "size: Letter" in doc


# --- Registry / playbook invariants ----------------------------------------------------------------

def test_playbook_steps_metadata_is_complete():
    assert [s["key"] for s in PLAYBOOK_STEPS] == ["load_inputs", "ground_facts", "check_quota", "generate", "save"]
    assert [s["key"] for s in PLAYBOOK_STEPS_REVIEW] == ["load_contract", "load_guidelines", "check_quota", "analyze", "save_findings"]
    for step in (*PLAYBOOK_STEPS, *PLAYBOOK_STEPS_REVIEW):
        assert step["title"] and step["description"] and step["likely_failures"]


def test_all_three_playbooks_registered():
    from app.services.missions import PLAYBOOK_REGISTRY

    for key in (PLAYBOOK_KEY, PLAYBOOK_KEY_REFINE, PLAYBOOK_KEY_REVIEW):
        assert key in PLAYBOOK_REGISTRY


def test_mission_generic_record_links_sign_request():
    from app.services.gadget_links import mission_generic_record

    assert mission_generic_record({"odoo_sign_request_id": 7}) == ("sign.request", 7, "Open signature request in Odoo")


# --- DB-backed: review drops un-anchorable findings + accept applies the redline --------------------

def _seed_seal(db):
    from app.models.sydekyk import Sydekyk
    from app.models.tenant import Tenant
    from app.sydekyks.seal.models import SealContract

    tenant = Tenant(name="Acme", slug="acme")
    db.add(tenant)
    db.flush()
    seal = Sydekyk(tenant_id=None, name="Seal", slug="seal", tagline="t", description="d",
                   avatar_url="/x.png", system_prompt="p", model="gpt-4o-mini", temperature=0.3,
                   is_exclusive=False, is_published=True, workflow_enabled=True, playbook_key="seal.draft")
    db.add(seal)
    db.flush()
    contract = SealContract(tenant_id=tenant.id, sydekyk_id=seal.id, title="Service Agreement",
                            content_html="<p>The provider accepts unlimited liability for all claims.</p>",
                            created_by="rep@acme.test")
    db.add(contract)
    db.commit()
    return tenant, seal, contract


def test_review_run_drops_unlocatable_findings(db, monkeypatch):
    from app.models.mission import Mission
    from app.sydekyks.seal import playbook
    from app.sydekyks.seal.models import SealReviewFinding

    tenant, seal, contract = _seed_seal(db)

    class _LLM:
        provider = "power_core"
        litellm_model_alias = "gpt-4o-mini"

    monkeypatch.setattr(mission_ai, "get_llm", lambda *_a, **_k: (_LLM(), "vk", "gpt-4o-mini"))
    monkeypatch.setattr(usage_guard, "check_allowed", lambda *_a, **_k: (True, None))
    monkeypatch.setattr(mission_ai, "emit_usage", lambda *_a, **_k: None)
    monkeypatch.setattr(playbook.extraction, "review_contract", lambda *_a, **_k: (True, "ok", [
        # Anchor present in the contract text — kept.
        {"clause_label": "Liability", "category": "liability_cap", "severity": "high",
         "issue": "uncapped", "rationale": "r", "clause_anchor": "unlimited liability", "suggested_redline": "capped"},
        # Anchor NOT present — must be dropped (no hallucinated clause).
        {"clause_label": "Ghost", "category": "other", "severity": "low",
         "issue": "x", "rationale": "r", "clause_anchor": "a clause that is not in the document", "suggested_redline": "y"},
    ], {}))

    mission = Mission(tenant_id=tenant.id, user_id=None, sydekyk_id=seal.id, mode="workflow_run",
                      signal_type="manual", playbook_key="seal.review", status="running",
                      trigger_context={"contract_id": str(contract.id)})
    db.add(mission)
    db.commit()

    playbook.run_review(db, mission)

    db.refresh(contract)
    assert mission.status == "succeeded"
    assert (mission.result_summary or {}).get("findings") == 1
    assert (mission.result_summary or {}).get("high") == 1
    kept = db.query(SealReviewFinding).filter(SealReviewFinding.contract_id == contract.id).all()
    assert len(kept) == 1 and kept[0].clause_anchor == "unlimited liability"
    assert contract.review_seq == 1


def test_accept_redline_swaps_anchor_in_html(db, monkeypatch):
    from app.models.user import User
    from app.sydekyks.seal.models import SealReviewFinding
    from app.sydekyks.seal.router import decide_finding
    from app.sydekyks.seal.schemas import FindingDecisionIn

    tenant, seal, contract = _seed_seal(db)
    user = User(tenant_id=tenant.id, email="rep@acme.test", hashed_password="x", role="commander")
    db.add(user)
    finding = SealReviewFinding(
        tenant_id=tenant.id, contract_id=contract.id, review_seq=1, clause_label="Liability",
        category="liability_cap", severity="high", issue="uncapped", rationale="r",
        clause_anchor="unlimited liability", suggested_redline="liability capped at fees paid", status="open",
    )
    contract.review_seq = 1
    db.add(finding)
    db.commit()

    out = decide_finding(contract.id, finding.id, FindingDecisionIn(decision="accept"), user=user, db=db)
    assert out.applied is True
    db.refresh(contract)
    assert "liability capped at fees paid" in contract.content_html
    assert "unlimited liability" not in contract.content_html
    db.refresh(finding)
    assert finding.status == "accepted"
