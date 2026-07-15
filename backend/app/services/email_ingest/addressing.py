import re
import secrets

_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _slugify(value: str) -> str:
    return _SLUG_RE.sub("-", (value or "").lower()).strip("-")


def build_inbound_local_part(tenant_slug: str, agent_key: str) -> str:
    """Human-readable inbound local-part: ``<tenant>-<agent>-<short>``.

    e.g. ``ibas-ledger-a1b2c3``. The tenant/agent prefix keeps the address legible (you can tell at a
    glance whose inbox it is and which Sydekyk it feeds); the short random suffix keeps it unguessable
    so outsiders can't email documents into a tenant's inbox just by knowing the pattern.
    """
    tenant = _slugify(tenant_slug) or "hq"
    agent = _slugify(agent_key) or "inbox"
    return f"{tenant}-{agent}-{secrets.token_hex(3)}"
