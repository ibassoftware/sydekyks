"""Unit tests for Decode/Scout pure logic — scoring bands + AI id-validation (no network, no DB)."""

from app.services import odoo_hr, vision_ai
from app.sydekyks.decode import extraction as decode_ext
from app.sydekyks.scout import scoring


class _FakeClient:
    """Captures the domain/limit search_untagged_applicants builds (no Odoo)."""

    def __init__(self):
        self.calls = []

    def search_read(self, model, domain, fields, limit=None):
        # find_tag also calls search_read (hr.applicant.category) — return a tag so the tag filter is added.
        if model == "hr.applicant.category":
            return [{"id": 7}]
        self.calls.append({"model": model, "domain": domain, "limit": limit})
        return []


def test_search_untagged_requires_job_and_caps():
    client = _FakeClient()
    odoo_hr.search_untagged_applicants(client, "Sydekyks: Scored", limit=100, require_job=True)
    call = client.calls[-1]
    assert call["limit"] == 30  # hard-capped at 30 regardless of the requested limit
    assert ["job_id", "!=", False] in call["domain"]  # Scout only scores job-assigned applicants
    assert ["categ_ids", "not in", [7]] in call["domain"]  # unprocessed-only


def test_search_untagged_without_require_job_omits_job_filter():
    client = _FakeClient()
    odoo_hr.search_untagged_applicants(client, "Sydekyks: Decoded", limit=10)
    call = client.calls[-1]
    assert not any(term[0] == "job_id" for term in call["domain"])  # Decode isn't job-constrained


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
