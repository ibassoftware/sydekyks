"""Shared Odoo activity + user helpers, reused by every agent's review-assignment tool (DRY). Lets an
agent create a `mail.activity` (an Odoo To-Do) on a flagged record for one or more assigned users, and
lets a cron verify those users still exist and are active. Version-safe: ids/types are resolved at
runtime, and mail.activity's To-Do type comes from its xmlid.
"""

from datetime import date, timedelta

from app.services.odoo import OdooClient

_TODO_XMLID = ("mail", "mail_activity_data_todo")


def list_internal_users(client: OdooClient, limit: int = 500) -> list[dict]:
    """Active internal (non-portal) Odoo users, for the reviewer picker in settings. Ordered by name;
    the picker filters client-side (fine up to a few hundred; bump the limit for larger instances)."""
    return client.execute_kw(
        "res.users", "search_read", [[["share", "=", False], ["active", "=", True]]],
        {"fields": ["id", "name", "login"], "order": "name asc", "limit": limit},
    )


def users_active_status(client: OdooClient, ids: list[int]) -> dict[int, bool]:
    """{user_id: is_active} for the given ids — including archived (active=False). Ids missing from the
    result no longer exist. Powers the 'assigned reviewer was removed/deactivated' audit."""
    if not ids:
        return {}
    rows = client.execute_kw(
        "res.users", "search_read", [[["id", "in", ids]]],
        {"fields": ["id", "active"], "context": {"active_test": False}},
    )
    return {r["id"]: bool(r["active"]) for r in rows}


def read_user_names(client: OdooClient, ids: list[int]) -> dict[int, str]:
    if not ids:
        return {}
    rows = client.execute_kw(
        "res.users", "search_read", [[["id", "in", ids]]],
        {"fields": ["id", "name"], "context": {"active_test": False}},
    )
    return {r["id"]: r["name"] for r in rows}


def _model_id(client: OdooClient, model: str) -> int | None:
    rows = client.search_read("ir.model", [["model", "=", model]], ["id"], limit=1)
    return rows[0]["id"] if rows else None


def _todo_type_id(client: OdooClient) -> int | None:
    try:
        ref = client.execute_kw("ir.model.data", "check_object_reference", list(_TODO_XMLID))
        return ref[1] if ref else None
    except Exception:  # noqa: BLE001 — activity_type is optional; fall back to none
        return None


def create_activity(
    client: OdooClient, *, model: str, res_id: int, user_id: int, summary: str,
    note: str | None = None, days: int = 3,
) -> int | None:
    """Create a To-Do `mail.activity` on `model`/`res_id` assigned to `user_id`, due in `days`."""
    model_id = _model_id(client, model)
    if model_id is None:
        return None
    vals: dict = {
        "res_model_id": model_id, "res_model": model, "res_id": res_id, "user_id": user_id,
        "summary": summary[:250], "date_deadline": (date.today() + timedelta(days=max(0, days))).isoformat(),
    }
    type_id = _todo_type_id(client)
    if type_id:
        vals["activity_type_id"] = type_id
    if note:
        vals["note"] = note
    return client.create("mail.activity", vals)
