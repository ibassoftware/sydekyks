"""Unit tests for Decode/Scout pure logic — scoring bands + AI id-validation (no network, no DB)."""

from app.services import vision_ai
from app.sydekyks.decode import extraction as decode_ext
from app.sydekyks.scout import scoring


def test_clamp_score():
    assert scoring.clamp_score(150) == 100
    assert scoring.clamp_score(-5) == 0
    assert scoring.clamp_score("88") == 88
    assert scoring.clamp_score(None) == 0


def test_priority_band():
    assert scoring.priority_band(90) == 3
    assert scoring.priority_band(75) == 2
    assert scoring.priority_band(55) == 1
    assert scoring.priority_band(30) == 0


def test_match_job_rejects_hallucinated_id(monkeypatch):
    monkeypatch.setattr(vision_ai, "llm_completion",
                        lambda *a, **k: (True, "ok", {"job_id": 999, "reasoning": "x"}, {}))
    ok, _msg, res, _meta = decode_ext.match_job(
        "v", "m", hint="", summary="", skills=[], available_jobs=[{"id": 1, "name": "Eng"}])
    assert ok and res["job_id"] is None  # 999 was never offered → dropped


def test_match_job_accepts_offered_id(monkeypatch):
    monkeypatch.setattr(vision_ai, "llm_completion",
                        lambda *a, **k: (True, "ok", {"job_id": 1, "reasoning": "fit"}, {}))
    ok, _msg, res, _meta = decode_ext.match_job(
        "v", "m", hint="", summary="", skills=[], available_jobs=[{"id": 1, "name": "Eng"}])
    assert res["job_id"] == 1


def test_map_skills_categorizes_by_type_name(monkeypatch):
    # The AI only picks a skill-type by NAME (reliable). Known category → that type's id; an unknown
    # category falls back to the first type; duplicates are de-duped. The playbook resolves skill ids.
    monkeypatch.setattr(vision_ai, "llm_completion", lambda *a, **k: (True, "ok", [
        {"name": "Python", "category": "Technical"},
        {"name": "Spanish", "category": "Languages"},
        {"name": "Teamwork", "category": "Nonexistent"},
        {"name": "python", "category": "Technical"},
    ], {}))
    ok, _msg, out, _meta = decode_ext.map_skills(
        "v", "m", ["Python", "Spanish", "Teamwork", "python"],
        skill_types=[{"id": 1, "name": "Technical"}, {"id": 2, "name": "Languages"}],
    )
    assert ok
    by_name = {r["name"]: r["skill_type_id"] for r in out}
    assert by_name["Python"] == 1
    assert by_name["Spanish"] == 2
    assert by_name["Teamwork"] == 1  # unknown category → first type (fallback)
    assert len(out) == 3  # "python" de-duped against "Python"
