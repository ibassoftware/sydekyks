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


def test_map_skills_validates_ids(monkeypatch):
    # Python: valid type + existing skill; Bad: invalid type (dropped); NewSkill: valid type, unknown
    # skill id (→ skill_id None so the playbook can create it when auto-create is on).
    monkeypatch.setattr(vision_ai, "llm_completion", lambda *a, **k: (True, "ok", [
        {"name": "Python", "skill_type_id": 1, "skill_id": 10},
        {"name": "Bad", "skill_type_id": 99, "skill_id": 10},
        {"name": "NewSkill", "skill_type_id": 1, "skill_id": 999},
    ], {}))
    ok, _msg, out, _meta = decode_ext.map_skills(
        "v", "m", ["Python", "Bad", "NewSkill"],
        skill_types=[{"id": 1, "name": "Tech"}],
        existing_skills=[{"id": 10, "name": "Python", "skill_type_id": [1, "Tech"]}],
    )
    assert ok
    names = {r["name"]: r for r in out}
    assert "Bad" not in names  # invalid skill_type_id dropped entirely
    assert names["Python"]["skill_id"] == 10
    assert names["NewSkill"]["skill_id"] is None  # hallucinated skill id nulled → create path
