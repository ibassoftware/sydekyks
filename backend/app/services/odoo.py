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


def test_connection(url: str, database: str, username: str, secret: str, timeout: float = 8.0) -> tuple[bool, str]:
    scheme = urlsplit(url).scheme
    if scheme not in ("http", "https"):
        return False, "Odoo URL must start with http:// or https://"

    transport_cls = _TimeoutSafeTransport if scheme == "https" else _TimeoutTransport
    common = xmlrpc.client.ServerProxy(
        f"{url.rstrip('/')}/xmlrpc/2/common",
        transport=transport_cls(timeout),
        allow_none=True,
    )
    try:
        uid = common.authenticate(database, username, secret, {})
    except xmlrpc.client.Fault as exc:
        return False, f"Odoo rejected the request: {exc.faultString}"
    except (OSError, xmlrpc.client.ProtocolError, ValueError) as exc:
        return False, f"Could not reach Odoo: {exc}"

    if not uid:
        return False, "Invalid database, username, or password/token."
    return True, f"Connected successfully (uid {uid})."
