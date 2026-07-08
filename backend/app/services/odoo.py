import base64
import xmlrpc.client
from urllib.parse import urlsplit


class _TimeoutTransport(xmlrpc.client.Transport):
    def __init__(self, timeout: float, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._timeout = timeout

    def make_connection(self, host):
        conn = super().make_connection(host)
        conn.timeout = self._timeout
        return conn


class _TimeoutSafeTransport(xmlrpc.client.SafeTransport):
    def __init__(self, timeout: float, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._timeout = timeout

    def make_connection(self, host):
        conn = super().make_connection(host)
        conn.timeout = self._timeout
        return conn


def _transport(url: str, timeout: float):
    scheme = urlsplit(url).scheme
    if scheme not in ("http", "https"):
        raise ValueError("Odoo URL must start with http:// or https://")
    cls = _TimeoutSafeTransport if scheme == "https" else _TimeoutTransport
    return cls(timeout)


def test_connection(url: str, database: str, username: str, secret: str, timeout: float = 8.0) -> tuple[bool, str]:
    try:
        transport = _transport(url, timeout)
    except ValueError as exc:
        return False, str(exc)

    common = xmlrpc.client.ServerProxy(f"{url.rstrip('/')}/xmlrpc/2/common", transport=transport, allow_none=True)
    try:
        uid = common.authenticate(database, username, secret, {})
    except xmlrpc.client.Fault as exc:
        return False, f"Odoo rejected the request: {exc.faultString}"
    except (OSError, xmlrpc.client.ProtocolError, ValueError) as exc:
        return False, f"Could not reach Odoo: {exc}"

    if not uid:
        return False, "Invalid database, username, or password/token."
    return True, f"Connected successfully (uid {uid})."


class OdooError(Exception):
    """Raised for any Odoo XML-RPC failure so callers can catch a single type."""


class OdooClient:
    """Thin authenticated wrapper around Odoo's /xmlrpc/2/object endpoint. Re-created per Mission
    run (no long-lived uid caching) — a background task is already its own isolated unit of work."""

    def __init__(self, url: str, database: str, uid: int, secret: str, timeout: float = 20.0):
        self.url = url.rstrip("/")
        self.database = database
        self.uid = uid
        self.secret = secret
        self._models = xmlrpc.client.ServerProxy(
            f"{self.url}/xmlrpc/2/object", transport=_transport(url, timeout), allow_none=True
        )

    def execute_kw(self, model: str, method: str, args: list, kwargs: dict | None = None):
        try:
            return self._models.execute_kw(self.database, self.uid, self.secret, model, method, args, kwargs or {})
        except xmlrpc.client.Fault as exc:
            raise OdooError(exc.faultString) from exc
        except (OSError, xmlrpc.client.ProtocolError, ValueError) as exc:
            raise OdooError(f"Could not reach Odoo: {exc}") from exc

    def search_read(self, model: str, domain: list, fields: list[str], limit: int | None = None) -> list[dict]:
        kwargs: dict = {"fields": fields}
        if limit is not None:
            kwargs["limit"] = limit
        return self.execute_kw(model, "search_read", [domain], kwargs)

    def create(self, model: str, values: dict) -> int:
        return self.execute_kw(model, "create", [values])

    def call(self, model: str, method: str, ids: list[int]):
        return self.execute_kw(model, method, [ids])

    def required_fields(self, model: str) -> list[str]:
        """Fields Odoo requires and that we can actually set (non-readonly) — used to adapt to
        custom modules that add required fields to a model."""
        fg = self.execute_kw(model, "fields_get", [], {"attributes": ["required", "readonly"]})
        return [name for name, meta in fg.items() if meta.get("required") and not meta.get("readonly")]


def connect(
    url: str, database: str, username: str, secret: str, timeout: float = 20.0
) -> tuple[bool, str, OdooClient | None]:
    try:
        transport = _transport(url, timeout)
    except ValueError as exc:
        return False, str(exc), None

    common = xmlrpc.client.ServerProxy(f"{url.rstrip('/')}/xmlrpc/2/common", transport=transport, allow_none=True)
    try:
        uid = common.authenticate(database, username, secret, {})
    except xmlrpc.client.Fault as exc:
        return False, f"Odoo rejected the request: {exc.faultString}", None
    except (OSError, xmlrpc.client.ProtocolError, ValueError) as exc:
        return False, f"Could not reach Odoo: {exc}", None

    if not uid:
        return False, "Invalid database, username, or password/token.", None
    return True, "connected", OdooClient(url, database, uid, secret, timeout)


# --- Generic business-object helpers (reusable by any Sydekyk needing Odoo) ---------------------


def find_partner(client: OdooClient, name: str) -> dict | None:
    """Best-effort vendor/partner lookup by name. Returns {id, name} or None."""
    matches = client.execute_kw("res.partner", "name_search", [name], {"limit": 1})
    if not matches:
        return None
    return {"id": matches[0][0], "name": matches[0][1]}


def create_partner(client: OdooClient, name: str, is_company: bool = True, extra: dict | None = None) -> int:
    values = {"name": name, "is_company": is_company}
    if extra:
        values.update(extra)
    return client.create("res.partner", values)


def list_active_currencies(client: OdooClient) -> list[dict]:
    """Every currency enabled in this Odoo instance — id + ISO code — so an AI (or anything else)
    matching a bill's currency can ground its choice in what's actually usable here, instead of
    guessing a bare code blind."""
    return client.search_read("res.currency", [["active", "=", True]], ["id", "name"])


def find_currency_id(client: OdooClient, iso_code: str) -> int | None:
    """Look up an Odoo res.currency id by its 3-letter ISO code (e.g. 'USD'). Prefers an active
    currency record when duplicates exist (a currency can be present but disabled)."""
    rows = client.search_read("res.currency", [["name", "=", iso_code.upper()]], ["id", "active"])
    if not rows:
        return None
    active = [r for r in rows if r.get("active")]
    return (active or rows)[0]["id"]


# --- Generic attachments / chatter / introspection (model-agnostic) -----------------------------


def fields_get(client: OdooClient, model: str, attributes: list[str] | None = None) -> dict:
    """Full field metadata for a model — lets a Sydekyk (or an AI) discover the real fields of a
    model at runtime instead of hardcoding them, so it survives Odoo version differences."""
    attrs = attributes or ["string", "type", "relation", "required", "readonly", "selection"]
    return client.execute_kw(model, "fields_get", [], {"attributes": attrs})


def attach_document(
    client: OdooClient, *, res_model: str, res_id: int, filename: str, content_bytes: bytes, mimetype: str
) -> tuple[bool, str]:
    """Attach a file to any record as an ir.attachment (base64 `datas`). Best-effort; returns
    (ok, message). Shared by every Sydekyk that needs to attach the original document."""
    try:
        client.create(
            "ir.attachment",
            {
                "name": filename,
                "datas": base64.b64encode(content_bytes).decode("ascii"),
                "res_model": res_model,
                "res_id": res_id,
                "mimetype": mimetype,
            },
        )
    except OdooError as exc:
        return False, str(exc)
    return True, "attached"


def read_attachments(
    client: OdooClient, *, res_model: str, res_id: int, mimetypes: list[str] | None = None, with_data: bool = False
) -> list[dict]:
    """List a record's attachments ({id, name, mimetype} + base64 `datas` when `with_data`),
    optionally filtered by mimetype. Used to pull a résumé PDF off an existing hr.applicant."""
    fields = ["id", "name", "mimetype"] + (["datas"] if with_data else [])
    rows = client.search_read("ir.attachment", [["res_model", "=", res_model], ["res_id", "=", res_id]], fields)
    if mimetypes:
        rows = [r for r in rows if r.get("mimetype") in mimetypes]
    return rows


def attachment_bytes(row: dict) -> bytes | None:
    """Decode an attachment row's base64 `datas` (from `read_attachments(..., with_data=True)`)."""
    data = row.get("datas")
    if not data:
        return None
    try:
        return base64.b64decode(data)
    except (ValueError, TypeError):
        return None


def post_message(client: OdooClient, *, model: str, res_id: int, body: str) -> tuple[bool, str]:
    """Post a chatter Note (message_post) on any record. Best-effort; returns (ok, message)."""
    try:
        client.execute_kw(model, "message_post", [[res_id]], {"body": body})
    except OdooError as exc:
        return False, str(exc)
    return True, "posted"
