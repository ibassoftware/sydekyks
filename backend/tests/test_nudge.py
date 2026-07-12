"""Unit tests for Nudge's staleness/prioritization math + AI draft parsing (no DB, no network)."""

from app.services import vision_ai
from app.sydekyks.nudge import extraction, scoring
from app.sydekyks.nudge.playbook import PLAYBOOK_STEPS


def test_stage_threshold_prefers_override_then_default():
    thresholds = {"5": 21, "3": 7}
    assert scoring.stage_threshold(thresholds, 14, 5) == 21   # per-stage override
    assert scoring.stage_threshold(thresholds, 14, 99) == 14  # no override → default
    assert scoring.stage_threshold(None, 14, 5) == 14         # no map → default
    assert scoring.stage_threshold({"5": "bad"}, 14, 5) == 14  # junk → default
    assert scoring.stage_threshold({}, 0, None) == 1          # floor of 1


def test_is_stale_boundary():
    assert scoring.is_stale(14, 14) is True   # exactly at tolerance counts as stale
    assert scoring.is_stale(13, 14) is False
    assert scoring.is_stale(40, 14) is True


def test_silence_score_scales_with_overdue_ratio_and_caps():
    assert scoring.silence_score(14, 14) == 50    # right at tolerance
    assert scoring.silence_score(28, 14) == 100   # 2x over → capped
    assert scoring.silence_score(70, 14) == 100   # capped at 100
    assert scoring.silence_score(7, 14) == 25


def test_value_at_risk_weights_revenue_by_overdue_ratio():
    # 30k opp, 3x past tolerance → 90k weighted exposure so bigger deals rank first.
    assert scoring.value_at_risk(30000, 42, 14) == 90000.0
    assert scoring.value_at_risk(None, 42, 14) == 0.0
    assert scoring.value_at_risk(1000, 14, 14) == 1000.0


def test_draft_followup_parses_and_defaults(monkeypatch):
    monkeypatch.setattr(
        vision_ai, "llm_completion",
        lambda *a, **k: (True, "ok",
                         {"subject": "Re: pricing", "body": "Circling back on the quote we discussed.",
                          "reasoning": "referenced the last quote"}, {}),
    )
    ok, _m, draft, _meta = extraction.draft_followup(
        "v", "m", name="Acme deal", stage="Proposition", contact="Jane",
        days_stale=20, thread=[{"author_id": [1, "Jane"], "date": "2026-07-01", "body": "<p>Send the quote</p>"}],
    )
    assert ok and draft["subject"] == "Re: pricing"
    assert "Circling back" in draft["body"]


def test_draft_followup_handles_missing_fields(monkeypatch):
    monkeypatch.setattr(vision_ai, "llm_completion", lambda *a, **k: (True, "ok", {}, {}))
    ok, _m, draft, _meta = extraction.draft_followup(
        "v", "m", name="X", stage=None, contact=None, days_stale=5, thread=[])
    assert ok and draft["subject"] == "Following up" and draft["body"] == ""


def test_draft_followup_propagates_ai_failure(monkeypatch):
    monkeypatch.setattr(vision_ai, "llm_completion", lambda *a, **k: (False, "engine down", None, {}))
    ok, msg, draft, _meta = extraction.draft_followup(
        "v", "m", name="X", stage="S", contact="C", days_stale=5, thread=[])
    assert ok is False and draft is None


def test_thread_formatting_strips_html_and_limits():
    msgs = [{"author_id": [1, "Rep"], "date": "2026-07-01T09:00:00", "body": "<p>Hello <b>there</b></p>"}]
    out = extraction._fmt_thread(msgs)
    assert "Hello there" in out and "<p>" not in out
    assert extraction._fmt_thread([]) == "(no prior messages on record)"


def test_reconcile_stage_thresholds_prunes_dead_overrides(db):
    from app.models.sydekyk import Sydekyk
    from app.models.tenant import Tenant
    from app.sydekyks.nudge import maintenance
    from app.sydekyks.nudge.models import NudgeTenantSettings

    tenant = Tenant(name="Acme", slug="acme")
    db.add(tenant)
    db.flush()
    nudge = Sydekyk(tenant_id=None, name="Nudge", slug="nudge", tagline="t", description="d",
                    avatar_url="/x.png", system_prompt="p", model="gpt-4o-mini", temperature=0.3,
                    is_exclusive=False, is_published=True, workflow_enabled=True, playbook_key="nudge.followup")
    db.add(nudge)
    db.flush()

    s = NudgeTenantSettings(tenant_id=tenant.id, stage_thresholds={"1": 7, "2": 14, "99": 30})
    db.add(s)
    db.commit()

    # Stage 99 no longer exists in Odoo → dropped; 1 and 2 kept.
    dropped = maintenance.reconcile_stage_thresholds(
        db, tenant_id=tenant.id, sydekyk_id=nudge.id, real_stage_ids={1, 2, 3}
    )
    assert dropped == [99]
    db.refresh(s)
    assert set(s.stage_thresholds.keys()) == {"1", "2"}

    # A failed stage read (empty set) must never prune.
    s.stage_thresholds = {"1": 7}
    db.commit()
    assert maintenance.reconcile_stage_thresholds(
        db, tenant_id=tenant.id, sydekyk_id=nudge.id, real_stage_ids=set()
    ) == []
    db.refresh(s)
    assert s.stage_thresholds == {"1": 7}


def test_playbook_steps_metadata_matches_expected_keys():
    """Guards the read-only Playbook panel against drifting from what run() records."""
    keys = [s["key"] for s in PLAYBOOK_STEPS]
    assert keys == [
        "connect_odoo",
        "load_opp",
        "check_guards",
        "measure_staleness",
        "draft",
        "record",
    ]
    for step in PLAYBOOK_STEPS:
        assert step["title"] and step["description"] and step["likely_failures"]
