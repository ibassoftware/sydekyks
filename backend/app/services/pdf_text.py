"""Best-effort embedded-text extraction from a PDF, for the text-first LLM path (cheaper than
sending page images). Returns None for non-PDFs, image-only/scanned PDFs, or on any failure — the
caller then falls back to the vision/rasterization path.
"""


def extract_text(document_bytes: bytes) -> str | None:
    if document_bytes[:5] != b"%PDF-":
        return None
    try:
        import pypdfium2 as pdfium
    except ImportError:
        return None

    from app.services.pdfium_lock import PDFIUM_LOCK

    # pdfium is not thread-safe: hold the process-wide lock for the whole open→read→close cycle so
    # concurrent Missions can't corrupt its state and crash the process.
    with PDFIUM_LOCK:
        try:
            pdf = pdfium.PdfDocument(document_bytes)
        except Exception:  # noqa: BLE001 — corrupt/encrypted PDF
            return None

        parts: list[str] = []
        try:
            for i in range(len(pdf)):
                page = pdf[i]
                textpage = page.get_textpage()
                try:
                    parts.append(textpage.get_text_range())
                finally:
                    textpage.close()
                    page.close()
        except Exception:  # noqa: BLE001 — any text quirk → let the caller fall back to images
            return None
        finally:
            pdf.close()

    text = "\n".join(p for p in parts if p).strip()
    return text or None
