"""Outbound transactional email — the platform's first send path.

Sends via the Postmark Server API using the server token already stored on `PostmarkConfig`
(`encrypted_server_token` — the Command Center sets it; until now nothing consumed it). Inbound
ingestion stays where it is; this is purely outbound. Built generic + keyed for reuse by any agent
that needs to send (Signet is the first consumer, for signing invitations + reminders).

Degrades cleanly: with no server token configured it returns False and raises a standing tenant issue
rather than throwing, so a mis-configured tenant surfaces one actionable Command-Center issue instead
of failing every send.
"""

import uuid

import httpx
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.crypto import decrypt_secret
from app.services import postmark_config, tenant_issues

_POSTMARK_SEND_URL = "https://api.postmarkapp.com/email"


def _server_token(db: Session) -> str | None:
    cfg = postmark_config.get_config(db)
    if not cfg.encrypted_server_token:
        return None
    try:
        return decrypt_secret(cfg.encrypted_server_token)
    except Exception:  # noqa: BLE001 — a corrupt token is "not configured" for our purposes
        return None


def send_email(
    db: Session,
    *,
    to: str,
    subject: str,
    html: str,
    reply_to: str | None = None,
    tag: str | None = None,
    tenant_id: uuid.UUID | None = None,
    sydekyk_id: uuid.UUID | None = None,
) -> bool:
    """Send one HTML email. Returns True on a 2xx from Postmark, False otherwise (a False result also
    raises a standing tenant issue when the token is missing, so it's visible without reading logs)."""
    token = _server_token(db)
    if not token:
        if tenant_id is not None:
            tenant_issues.report_issue(
                db, tenant_id=tenant_id, sydekyk_id=sydekyk_id, kind="outbound_email_unconfigured",
                title="Outbound email is not configured",
                detail="Set the Postmark server token in the Command Center to let Signet send signing emails.",
            )
        return False

    from_addr = f"{settings.email_from_name} <{settings.email_from_address}>"
    payload = {
        "From": from_addr,
        "To": to,
        "Subject": subject,
        "HtmlBody": html,
        "MessageStream": "outbound",
    }
    if reply_to:
        payload["ReplyTo"] = reply_to
    if tag:
        payload["Tag"] = tag
    try:
        resp = httpx.post(
            _POSTMARK_SEND_URL,
            json=payload,
            headers={"X-Postmark-Server-Token": token, "Accept": "application/json"},
            timeout=20.0,
        )
    except httpx.HTTPError:
        return False
    return 200 <= resp.status_code < 300


def default_reply_to(db: Session, *, tenant_slug: str, agent_key: str) -> str:
    """A per-tenant/agent Reply-To on the inbound domain, so a signer's reply threads back through the
    existing inbound webhook (mirrors the inbound addressing scheme)."""
    from app.services.email_ingest.addressing import build_inbound_local_part

    local = build_inbound_local_part(tenant_slug, agent_key)
    return f"{local}@{postmark_config.get_inbound_domain(db)}"
