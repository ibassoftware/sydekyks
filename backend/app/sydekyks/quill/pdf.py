"""Proposal HTML → PDF (WeasyPrint) + optional PDF merge (pypdf).

Heavy/native imports (WeasyPrint pulls pango/cairo) are done lazily inside the functions so importing
the Quill package for discovery never requires the system libraries to be present — only an actual
export call does. A missing dependency surfaces as a clean error to the caller.
"""

import html as _html
import io

_BASE_CSS = """
@page {{ size: {page_size}; margin: 20mm 18mm; }}
* {{ box-sizing: border-box; }}
body {{ font-family: Georgia, 'Times New Roman', serif; color: #1a1a1a; font-size: 11pt; line-height: 1.5; }}
h1, h2, h3 {{ font-family: Georgia, serif; color: {accent}; line-height: 1.2; margin: 0.6em 0 0.3em; }}
h1 {{ font-size: 22pt; }} h2 {{ font-size: 16pt; }} h3 {{ font-size: 13pt; }}
p {{ margin: 0 0 0.6em; }}
img {{ max-width: 100%; height: auto; }}
table {{ width: 100%; border-collapse: collapse; margin: 0.6em 0; }}
th, td {{ border: 1px solid #d9d9d9; padding: 6px 8px; text-align: left; font-size: 10pt; }}
th {{ background: {accent}; color: #fff; }}
ul, ol {{ margin: 0 0 0.6em 1.2em; }}
.quill-header {{ border-bottom: 2px solid {accent}; padding-bottom: 8px; margin-bottom: 16px; }}
.quill-logo {{ max-height: 60px; margin-bottom: 8px; }}
"""


def build_document(content_html: str, *, title: str | None = None, page_size: str = "A4",
                   accent: str | None = None, logo_data_uri: str | None = None) -> str:
    """Wrap a proposal HTML fragment in a full, print-styled HTML document."""
    accent = accent or "#8a6d1a"
    css = _BASE_CSS.format(page_size=page_size or "A4", accent=accent)
    header = ""
    if logo_data_uri:
        header += f'<img class="quill-logo" src="{logo_data_uri}" alt="logo"/>'
    if title:
        header += f"<h1>{_html.escape(title)}</h1>"
    header_block = f'<div class="quill-header">{header}</div>' if header else ""
    return (
        "<!DOCTYPE html><html><head><meta charset='utf-8'>"
        f"<style>{css}</style></head><body>{header_block}{content_html or ''}</body></html>"
    )


def render_html_to_pdf(document_html: str, *, base_url: str | None = None) -> bytes:
    """Render a full HTML document to PDF bytes via WeasyPrint. `base_url` lets relative asset URLs
    resolve (we normally inline images as absolute URLs / data URIs, so it's usually unnecessary)."""
    try:
        from weasyprint import HTML  # noqa: PLC0415 — lazy, avoids native deps at import time
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError(
            "PDF export needs WeasyPrint (and its system libraries pango/cairo/gdk-pixbuf). "
            "Install it on the backend to enable Quill PDF export."
        ) from exc
    return HTML(string=document_html, base_url=base_url).write_pdf()


def merge_pdfs(parts: list[bytes]) -> bytes:
    """Concatenate several PDFs (e.g. the proposal + the official Odoo quotation) into one."""
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
