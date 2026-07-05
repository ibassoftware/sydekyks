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
