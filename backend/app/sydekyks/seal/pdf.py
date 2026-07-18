"""Contract HTML → PDF (WeasyPrint) + optional PDF merge (pypdf).

Heavy/native imports (WeasyPrint pulls pango/cairo) are done lazily inside the functions so importing
the Seal package for discovery never requires the system libraries to be present - only an actual
export call does. A missing dependency surfaces as a clean error to the caller.
"""

import html as _html
import io

_BASE_CSS = """
@page {{
  size: {page_size}; margin: 24mm 18mm 24mm;
  @top-left {{ content: {header_left}; font-family: Georgia, serif; font-size: 8pt; color: #999; }}
  @top-right {{ content: {header_right}; font-family: Georgia, serif; font-size: 8pt; color: #999; }}
  @bottom-left {{ content: {footer_left}; font-family: Georgia, serif; font-size: 8pt; color: #888; }}
  @bottom-right {{ content: "Page " counter(page) " of " counter(pages); font-family: Georgia, serif; font-size: 8pt; color: #888; }}
}}
* {{ box-sizing: border-box; }}
body {{ font-family: Georgia, 'Times New Roman', serif; color: #1a1a1a; font-size: 11pt; line-height: 1.5; }}
h1, h2, h3 {{ font-family: Georgia, serif; color: {accent}; line-height: 1.2; margin: 0.6em 0 0.3em; }}
h1 {{ font-size: 20pt; text-align: center; }} h2 {{ font-size: 14pt; }} h3 {{ font-size: 12pt; }}
p {{ margin: 0 0 0.6em; text-align: justify; }}
img {{ max-width: 100%; height: auto; }}
table {{ width: 100%; border-collapse: collapse; margin: 0.6em 0; }}
th, td {{ border: 1px solid #d9d9d9; padding: 6px 8px; text-align: left; font-size: 10pt; }}
th {{ background: {accent}; color: #fff; }}
ol {{ margin: 0 0 0.6em 1.2em; }}
ul {{ margin: 0 0 0.6em 1.2em; }}
.seal-header {{ border-bottom: 2px solid {accent}; padding-bottom: 8px; margin-bottom: 16px; }}
.seal-logo {{ max-height: 60px; margin-bottom: 8px; }}
"""


def _css_string(value: str | None) -> str:
    """A CSS `content` string literal (escaped), or the empty string literal when absent."""
    if not value:
        return '""'
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def build_document(content_html: str, *, title: str | None = None, page_size: str = "A4",
                   accent: str | None = None, logo_data_uri: str | None = None,
                   header_text: str | None = None, footer_text: str | None = None) -> str:
    """Wrap a contract HTML fragment in a full, print-styled HTML document with a running header/footer
    (optional header line top-left + title top-right; footer line bottom-left + page numbers bottom-right)."""
    accent = accent or "#1e3a5f"  # professional navy default; overridden by the tenant's accent setting
    css = _BASE_CSS.format(
        page_size=page_size or "A4", accent=accent,
        header_left=_css_string(header_text),
        header_right=_css_string(title if header_text else None),
        footer_left=_css_string(footer_text),
    )
    header = ""
    if logo_data_uri:
        header += f'<img class="seal-logo" src="{logo_data_uri}" alt="logo"/>'
    if title:
        header += f"<h1>{_html.escape(title)}</h1>"
    header_block = f'<div class="seal-header">{header}</div>' if header else ""
    return (
        "<!DOCTYPE html><html><head><meta charset='utf-8'>"
        f"<style>{css}</style></head><body>{header_block}{content_html or ''}</body></html>"
    )


def render_html_to_pdf(document_html: str, *, base_url: str | None = None) -> bytes:
    """Render a full HTML document to PDF bytes via WeasyPrint."""
    try:
        from weasyprint import HTML  # noqa: PLC0415 - lazy, avoids native deps at import time
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError(
            "PDF export needs WeasyPrint (and its system libraries pango/cairo/gdk-pixbuf). "
            "Install it on the backend to enable Seal PDF export."
        ) from exc
    return HTML(string=document_html, base_url=base_url).write_pdf()


def merge_pdfs(parts: list[bytes]) -> bytes:
    """Concatenate several PDFs into one."""
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
