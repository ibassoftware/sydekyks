"""Shared Odoo CRM reads for the sales agents (Nudge = follow-up). Built on the generic OdooClient;
field names are the stable crm.lead / crm.stage / mail.message set, read defensively so it survives
Odoo versions. Activity creation reuses the shared `odoo_activity` helper (mail.activity is generic).
"""

from datetime import date, datetime

from app.services import odoo
from app.services.odoo import OdooClient

# Superset of the fields we'd like on an opportunity. Some are version-specific (e.g. the currency
# many2one is `company_currency` on modern crm.lead, `currency_id` on older ones), so every read is
# filtered to what the instance actually exposes via `_opp_fields` — never request an unknown field.
OPP_FIELDS = [
    "id", "name", "type", "stage_id", "probability", "active", "expected_revenue",
    "company_currency", "currency_id", "user_id", "partner_id", "partner_name", "contact_name",
    "email_from", "write_date", "create_date", "date_last_stage_update", "activity_date_deadline",
    "tag_ids", "date_deadline",
]

_FIELD_CACHE: dict[int, set[str]] = {}


def _available_fields(client: OdooClient) -> set[str]:
    """crm.lead's real field names on this instance (cached per client) — the basis for version-safe
    reads. Falls back to assuming everything exists if fields_get can't be read."""
    key = id(client)
    cached = _FIELD_CACHE.get(key)
    if cached is None:
        try:
            cached = set(client.execute_kw("crm.lead", "fields_get", [], {"attributes": []}).keys())
        except Exception:  # noqa: BLE001 — degrade to no filtering rather than fail the read
            cached = set(OPP_FIELDS)
        _FIELD_CACHE[key] = cached
    return cached


def _opp_fields(client: OdooClient) -> list[str]:
    avail = _available_fields(client)
    return [f for f in OPP_FIELDS if f in avail]


def currency_name(lead: dict) -> str | None:
    """Version-safe currency label off an opportunity (either the modern `company_currency` or the
    legacy `currency_id` many2one)."""
    for key in ("company_currency", "currency_id"):
        v = lead.get(key)
        if isinstance(v, list) and len(v) > 1:
            return v[1]
    return None


def list_stages(client: OdooClient) -> list[dict]:
    return client.search_read("crm.stage", [], ["id", "name", "is_won", "sequence"])


def won_stage_ids(client: OdooClient) -> list[int]:
    return [s["id"] for s in list_stages(client) if s.get("is_won")]


def read_lead(client: OdooClient, lead_id: int, fields: list[str] | None = None) -> dict | None:
    rows = client.execute_kw("crm.lead", "read", [[lead_id]], {"fields": fields or _opp_fields(client)})
    return rows[0] if rows else None


def list_open_opportunities(client: OdooClient, *, cutoff: str, limit: int, won_ids: list[int]) -> list[dict]:
    """Open opportunities (active, not won) that have no *future* scheduled activity and haven't been
    touched since `cutoff` — the candidate set for staleness checks. Overdue-activity opps are
    included (their next-activity deadline is in the past). Oldest-touched first."""
    today = date.today().isoformat()
    domain: list = [
        ["type", "=", "opportunity"],
        ["active", "=", True],
        ["probability", "<", 100],
        ["write_date", "<", cutoff],
        "|", ["activity_date_deadline", "=", False], ["activity_date_deadline", "<", today],
    ]
    if won_ids:
        domain.append(["stage_id", "not in", won_ids])
    return client.execute_kw(
        "crm.lead", "search_read", [domain],
        {"fields": _opp_fields(client), "order": "write_date asc, id asc", "limit": limit},
    )


def count_open_opportunities(client: OdooClient, *, won_ids: list[int]) -> int:
    """Total open (active, not won) opportunities — the denominator for 'follow-ups never missed'."""
    domain: list = [["type", "=", "opportunity"], ["active", "=", True], ["probability", "<", 100]]
    if won_ids:
        domain.append(["stage_id", "not in", won_ids])
    return client.execute_kw("crm.lead", "search_count", [domain])


def _msgs(client: OdooClient, lead_id: int, *, fields: list[str], limit: int) -> list[dict]:
    return client.execute_kw(
        "mail.message", "search_read",
        [[["model", "=", "crm.lead"], ["res_id", "=", lead_id], ["message_type", "in", ["comment", "email"]]]],
        {"fields": fields, "order": "date desc", "limit": limit},
    )


def last_touch_date(client: OdooClient, lead: dict) -> date | None:
    """The most recent real touch on the opp: the latest chatter/email message, falling back to the
    last stage change / write. Drives 'days silent'."""
    rows = _msgs(client, lead["id"], fields=["date"], limit=1)
    candidates = []
    if rows and rows[0].get("date"):
        candidates.append(_parse(rows[0]["date"]))
    for key in ("date_last_stage_update", "write_date"):
        d = _parse(lead.get(key))
        if d:
            candidates.append(d)
    return max(candidates) if candidates else None


def read_thread(client: OdooClient, lead_id: int, limit: int = 6) -> list[dict]:
    """Recent chatter/emails on the opp (newest first) for the AI to ground the draft in the real
    last exchange."""
    return _msgs(client, lead_id, fields=["date", "author_id", "subject", "body"], limit=limit)


def has_future_activity(client: OdooClient, lead_id: int) -> bool:
    today = date.today().isoformat()
    return client.execute_kw(
        "mail.activity", "search_count",
        [[["res_model", "=", "crm.lead"], ["res_id", "=", lead_id], ["date_deadline", ">=", today]]],
    ) > 0


def has_overdue_activity(client: OdooClient, lead_id: int) -> bool:
    today = date.today().isoformat()
    return client.execute_kw(
        "mail.activity", "search_count",
        [[["res_model", "=", "crm.lead"], ["res_id", "=", lead_id], ["date_deadline", "<", today]]],
    ) > 0


def post_note(client: OdooClient, lead_id: int, body: str) -> tuple[bool, str]:
    return odoo.post_message(client, model="crm.lead", res_id=lead_id, body=body)


def _parse(v) -> date | None:
    if not v:
        return None
    try:
        return datetime.fromisoformat(str(v).replace("Z", "").split(".")[0]).date()
    except ValueError:
        try:
            return date.fromisoformat(str(v)[:10])
        except ValueError:
            return None
