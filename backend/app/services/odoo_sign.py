"""Odoo Sign (`sign.template` / `sign.request`) helpers — the platform's e-signature handoff for
tenants on Odoo Enterprise (the Sign app is Enterprise-only).

Version-safe and strictly best-effort like the rest of the Odoo layer: the Sign models may not exist
on a given instance (Community, or the app isn't installed), and field shapes vary across versions, so
every call degrades to `None` rather than raising. Seal offers this path when it's available and falls
back to the native Signet flow otherwise. Reusable by any future signing Sydekyk.

⚠️ Confirm field/relation shapes with `fields_get` on a real Sign-enabled instance before relying on
these in production — they are written against the common Odoo 15–17 shapes.
"""

import base64

from app.services import odoo


def sign_available(client: odoo.OdooClient) -> bool:
    """True when the instance exposes the Sign models (Enterprise + app installed)."""
    try:
        odoo.fields_get(client, "sign.template")
        return True
    except odoo.OdooError:
        return False
    except Exception:  # noqa: BLE001 — any transport/marshalling quirk means "treat as unavailable"
        return False


def create_sign_template(client: odoo.OdooClient, *, name: str, pdf_bytes: bytes) -> int | None:
    """Create a `sign.template` from a contract PDF. Returns the template id, or None on any snag."""
    try:
        attachment_id = client.create("ir.attachment", {
            "name": f"{name}.pdf",
            "datas": base64.b64encode(pdf_bytes).decode("ascii"),
            "mimetype": "application/pdf",
        })
        return client.create("sign.template", {"name": name, "attachment_id": attachment_id})
    except odoo.OdooError:
        return None
    except Exception:  # noqa: BLE001
        return None


def request_signature(client: odoo.OdooClient, *, template_id: int, signer_partner_ids: list[int]) -> int | None:
    """Create a `sign.request` for the template with the given partners as signers. Best-effort — the
    request-item shape varies by version, so we skip signer wiring rather than fail if it's rejected."""
    try:
        request_id = client.create("sign.request", {
            "template_id": int(template_id),
            "reference": "Seal contract",
        })
    except odoo.OdooError:
        return None
    except Exception:  # noqa: BLE001
        return None
    for pid in signer_partner_ids or []:
        try:
            client.create("sign.request.item", {"sign_request_id": request_id, "partner_id": int(pid)})
        except odoo.OdooError:
            continue
        except Exception:  # noqa: BLE001
            continue
    return request_id
