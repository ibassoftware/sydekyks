"""Render a Seal contract to PDF bytes - shared by the Seal export endpoint and by Signet (which turns
a finished contract into the source document for a signing envelope). Keeps the inline-image + branding
logic in one place so both callers produce identical PDFs.
"""

import base64
import re
import uuid

from sqlalchemy.orm import Session

from app.sydekyks.seal import pdf as pdf_svc
from app.sydekyks.seal.models import SealAsset, SealContract, SealTenantSettings

_ASSET_SRC = re.compile(r'src="(?:[^"]*?/api/tenant/seal/assets/([0-9a-fA-F-]{36}))"')


def inline_asset_images(db: Session, tenant_id, html: str) -> str:
    """Replace /api/tenant/seal/assets/<id> image srcs with data URIs so WeasyPrint (no auth context)
    can render them."""
    if not html:
        return html or ""

    def repl(m: "re.Match") -> str:
        aid = m.group(1)
        try:
            asset = db.get(SealAsset, uuid.UUID(aid))
        except (ValueError, TypeError):
            return m.group(0)
        if asset is None or asset.tenant_id != tenant_id:
            return m.group(0)
        uri = f"data:{asset.content_type};base64,{base64.b64encode(asset.content).decode('ascii')}"
        return f'src="{uri}"'

    return _ASSET_SRC.sub(repl, html)


def render_contract_pdf(db: Session, tenant_id, contract: SealContract) -> bytes:
    """The branded contract PDF. Raises RuntimeError when WeasyPrint isn't installed."""
    s = db.query(SealTenantSettings).filter(SealTenantSettings.tenant_id == tenant_id).first()
    page_size = s.page_size if s else "A4"
    accent = s.accent_color if s else None
    header_text = s.header_text if s else None
    footer_text = s.footer_text if s else None
    logo_uri = None
    if s and s.logo_asset_id:
        logo = db.get(SealAsset, s.logo_asset_id)
        if logo is not None and logo.tenant_id == tenant_id:
            logo_uri = f"data:{logo.content_type};base64,{base64.b64encode(logo.content).decode('ascii')}"
    html_doc = pdf_svc.build_document(
        inline_asset_images(db, tenant_id, contract.content_html),
        title=contract.title, page_size=page_size, accent=accent, logo_data_uri=logo_uri,
        header_text=header_text, footer_text=footer_text,
    )
    return pdf_svc.render_html_to_pdf(html_doc)
