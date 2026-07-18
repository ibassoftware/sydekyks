"""Signed-PDF assembly - stamp a signature page onto the source document and append a signing
certificate (who signed, when, from where). WeasyPrint + pypdf, imported lazily so package discovery
never needs the native libraries; only an actual completion does.
"""

import base64
import html as _html
import io
from datetime import datetime

_CERT_CSS = """
@page { size: A4; margin: 20mm; }
body { font-family: Georgia, 'Times New Roman', serif; color: #1a1a1a; font-size: 11pt; }
h1 { font-size: 18pt; color: #1e3a5f; }
h2 { font-size: 13pt; color: #1e3a5f; margin-top: 1.2em; }
table { width: 100%; border-collapse: collapse; margin-top: 8px; }
th, td { border: 1px solid #d9d9d9; padding: 6px 8px; text-align: left; font-size: 10pt; vertical-align: top; }
th { background: #1e3a5f; color: #fff; }
.sig-img { max-height: 48px; }
.muted { color: #888; font-size: 9pt; }
"""


def _fmt(dt: datetime | None) -> str:
    return dt.strftime("%Y-%m-%d %H:%M UTC") if dt else " - "


def build_certificate_html(*, title: str, signers: list[dict], completed_at: datetime | None) -> str:
    """`signers` items: {name, email, signed_at, ip, signature_image_uri (optional)}."""
    rows = []
    for s in signers:
        img = f'<img class="sig-img" src="{s["signature_image_uri"]}"/>' if s.get("signature_image_uri") else ""
        sig_cell = img or _html.escape(s.get("signature_name") or s.get("name") or "")
        rows.append(
            "<tr>"
            f"<td>{_html.escape(s.get('name') or '')}<br><span class='muted'>{_html.escape(s.get('email') or '')}</span></td>"
            f"<td>{sig_cell}</td>"
            f"<td>{_fmt(s.get('signed_at'))}</td>"
            f"<td class='muted'>{_html.escape(s.get('ip') or ' - ')}</td>"
            "</tr>"
        )
    table = (
        "<table><tr><th>Signer</th><th>Signature</th><th>Signed at</th><th>IP address</th></tr>"
        + "".join(rows) + "</table>"
    )
    return (
        "<!DOCTYPE html><html><head><meta charset='utf-8'>"
        f"<style>{_CERT_CSS}</style></head><body>"
        "<h1>Certificate of Completion</h1>"
        f"<p>Document: <strong>{_html.escape(title)}</strong></p>"
        f"<p class='muted'>Completed {_fmt(completed_at)} · issued by Signet</p>"
        "<h2>Signers</h2>"
        f"{table}"
        "</body></html>"
    )


def render_certificate_pdf(html_doc: str) -> bytes:
    try:
        from weasyprint import HTML  # noqa: PLC0415
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError(
            "Signed-PDF assembly needs WeasyPrint (pango/cairo/gdk-pixbuf). Install it on the backend."
        ) from exc
    return HTML(string=html_doc).write_pdf()


def merge_pdfs(parts: list[bytes]) -> bytes:
    from pypdf import PdfReader, PdfWriter  # noqa: PLC0415

    writer = PdfWriter()
    for raw in parts:
        if not raw:
            continue
        reader = PdfReader(io.BytesIO(raw))
        for page in reader.pages:
            writer.add_page(page)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def signature_image_uri(png_bytes: bytes | None) -> str | None:
    if not png_bytes:
        return None
    return f"data:image/png;base64,{base64.b64encode(png_bytes).decode('ascii')}"


def assemble_signed_pdf(*, source_pdf: bytes, title: str, signers: list[dict], completed_at: datetime | None) -> bytes:
    """Source document + an appended certificate-of-completion page."""
    cert_html = build_certificate_html(title=title, signers=signers, completed_at=completed_at)
    cert_pdf = render_certificate_pdf(cert_html)
    return merge_pdfs([source_pdf, cert_pdf])
