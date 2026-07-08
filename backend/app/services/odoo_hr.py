"""Shared Odoo recruitment (hr.applicant) operations — the DRY layer reused by both the Decode
(parser) and Scout (scorer) Sydekyks. Built on the generic `OdooClient`; field names are read at
runtime via `applicant_fields()` (`fields_get`) so callers can adapt to Odoo version differences.

Verified against Odoo 18: hr.applicant has partner_name/email_from/partner_phone/job_id, categ_ids
(→ hr.applicant.category tags), priority ('0'..'3' stars), applicant_skill_ids (→ hr.applicant.skill
requiring skill_type_id + skill_id + skill_level_id), applicant_notes (html).
"""

from app.services import odoo
from app.services.odoo import OdooClient

_APPLICANT_LIST_FIELDS = ["id", "partner_name", "email_from", "partner_phone", "job_id"]


# --- Jobs -------------------------------------------------------------------------------------


def list_jobs(client: OdooClient) -> list[dict]:
    return client.search_read("hr.job", [], ["id", "name", "description"])


def read_job(client: OdooClient, job_id: int) -> dict | None:
    rows = client.execute_kw("hr.job", "read", [[job_id]], {"fields": ["name", "description"]})
    return rows[0] if rows else None


# --- Applicants -------------------------------------------------------------------------------


def applicant_fields(client: OdooClient) -> dict:
    """Runtime field schema of hr.applicant — fed to the AI field-mapper so it targets the real,
    settable fields of THIS instance (version-safe)."""
    return odoo.fields_get(client, "hr.applicant")


def create_applicant(client: OdooClient, values: dict) -> int:
    return client.create("hr.applicant", values)


def read_applicant(client: OdooClient, applicant_id: int, fields: list[str]) -> dict | None:
    rows = client.execute_kw("hr.applicant", "read", [[applicant_id]], {"fields": fields})
    return rows[0] if rows else None


def update_applicant(client: OdooClient, applicant_id: int, values: dict) -> None:
    client.execute_kw("hr.applicant", "write", [[applicant_id], values])


def set_priority(client: OdooClient, applicant_id: int, stars: int) -> None:
    """priority is a selection '0'..'3' (Evaluation stars)."""
    stars = max(0, min(3, int(stars)))
    update_applicant(client, applicant_id, {"priority": str(stars)})


def read_resume_attachment(client: OdooClient, applicant_id: int) -> tuple[bytes, str, str] | None:
    """The first PDF attached to an applicant → (bytes, filename, mimetype), or None."""
    rows = odoo.read_attachments(
        client, res_model="hr.applicant", res_id=applicant_id, mimetypes=["application/pdf"], with_data=True
    )
    for r in rows:
        data = odoo.attachment_bytes(r)
        if data:
            return data, r.get("name") or "resume.pdf", r.get("mimetype") or "application/pdf"
    return None


def post_note(client: OdooClient, applicant_id: int, body: str) -> tuple[bool, str]:
    return odoo.post_message(client, model="hr.applicant", res_id=applicant_id, body=body)


# --- Tags (hr.applicant.category) — used as the "already processed" marker ---------------------


def find_tag(client: OdooClient, name: str) -> int | None:
    rows = client.search_read("hr.applicant.category", [["name", "=", name]], ["id"], limit=1)
    return rows[0]["id"] if rows else None


def ensure_tag(client: OdooClient, name: str) -> int:
    return find_tag(client, name) or client.create("hr.applicant.category", {"name": name})


def add_tag(client: OdooClient, applicant_id: int, tag_id: int) -> None:
    update_applicant(client, applicant_id, {"categ_ids": [(4, tag_id)]})


def search_untagged_applicants(
    client: OdooClient, tag_name: str, *, since: str | None = None, limit: int = 30
) -> list[dict]:
    """Applicants NOT yet stamped with `tag_name` (the per-Sydekyk processed marker) — the
    unprocessed-only cron query. Never returns already-processed records. Hard-capped at 30."""
    limit = min(limit or 30, 30)
    domain: list = []
    tag_id = find_tag(client, tag_name)
    if tag_id:  # if the tag doesn't exist yet, nothing is tagged → no filter needed
        domain.append(["categ_ids", "not in", [tag_id]])
    if since:
        domain.append(["create_date", ">", since])
    return client.search_read("hr.applicant", domain, _APPLICANT_LIST_FIELDS, limit=limit)


# --- Skills (hr.skill.type / hr.skill / hr.skill.level / hr.applicant.skill) -------------------


def list_skill_types(client: OdooClient) -> list[dict]:
    return client.search_read("hr.skill.type", [], ["id", "name"])


def list_skills(client: OdooClient) -> list[dict]:
    return client.search_read("hr.skill", [], ["id", "name", "skill_type_id"])


def default_skill_level(client: OdooClient, skill_type_id: int) -> int | None:
    """A skill_type's default level (hr.applicant.skill requires a skill_level_id)."""
    rows = client.search_read("hr.skill.level", [["skill_type_id", "=", skill_type_id]], ["id", "default_level"])
    if not rows:
        return None
    default = [r for r in rows if r.get("default_level")]
    return (default or rows)[0]["id"]


def ensure_skill(client: OdooClient, name: str, skill_type_id: int) -> int:
    """Find an hr.skill by name under a type, else create it (used when auto-create-skills is on)."""
    rows = client.search_read(
        "hr.skill", [["name", "=", name], ["skill_type_id", "=", skill_type_id]], ["id"], limit=1
    )
    return rows[0]["id"] if rows else client.create("hr.skill", {"name": name, "skill_type_id": skill_type_id})


def set_applicant_skills(client: OdooClient, applicant_id: int, specs: list[dict]) -> None:
    """Attach skills to an applicant via the applicant_skill_ids one2many. Each spec needs
    `skill_type_id`, `skill_id`, `skill_level_id` (all required by hr.applicant.skill)."""
    cmds = [
        (0, 0, {"skill_type_id": s["skill_type_id"], "skill_id": s["skill_id"], "skill_level_id": s["skill_level_id"]})
        for s in specs
        if s.get("skill_type_id") and s.get("skill_id") and s.get("skill_level_id")
    ]
    if cmds:
        update_applicant(client, applicant_id, {"applicant_skill_ids": cmds})
