"""Shared LLM/vision plumbing for document-reading Sydekyks (Ledger, Decode, Scout, ...).

Extracted from Ledger's extraction module so every Sydekyk shares one caller and one text-vs-image
convention. `document_to_llm_input` implements the **text-first, image-fallback** policy: a PDF with a
real text layer is sent as cheap plain text; scanned/photo documents fall back to rasterized page
images for the vision model.
"""

import base64
import io
import json
import re

import httpx

from app.core.config import settings

_DEFAULT_MAX_PDF_PAGES = 3
_PDF_RENDER_SCALE = 2.5  # ~180 DPI — enough for a model to read document text
# A PDF whose extracted text layer is at least this many chars is treated as a true text PDF (send
# text, skip the far pricier image path). Below it we assume a scan/photo and rasterize. Kept low:
# real text documents comfortably exceed this, while scans/photos yield ~0 extractable chars, so a
# low floor maximizes the cheap text path without misreading an image-only PDF as text.
_MIN_TEXT_CHARS = 100


def data_uri(content_type: str, raw: bytes) -> str:
    return f"data:{content_type};base64,{base64.b64encode(raw).decode('ascii')}"


def document_to_image_uris(
    document_bytes: bytes, content_type: str, *, max_pages: int = _DEFAULT_MAX_PDF_PAGES
) -> tuple[list[str], str | None]:
    """Turn a document into image data URIs a vision model can read. Images pass straight through;
    PDFs are rasterized page-by-page to PNG (capped at `max_pages`)."""
    is_pdf = content_type == "application/pdf" or document_bytes[:5] == b"%PDF-"
    if not is_pdf:
        return [data_uri(content_type or "image/png", document_bytes)], None

    try:
        import pypdfium2 as pdfium
    except ImportError:
        return [], "PDF support isn't installed (pypdfium2). Install it or upload an image."

    try:
        pdf = pdfium.PdfDocument(document_bytes)
    except Exception as exc:  # noqa: BLE001 — corrupt/encrypted PDF
        return [], f"Couldn't open the PDF: {exc}"

    uris: list[str] = []
    try:
        for i in range(min(len(pdf), max_pages)):
            bitmap = pdf[i].render(scale=_PDF_RENDER_SCALE)
            buf = io.BytesIO()
            bitmap.to_pil().save(buf, format="PNG")
            uris.append(data_uri("image/png", buf.getvalue()))
    finally:
        pdf.close()
    if not uris:
        return [], "The PDF had no rasterizable pages."
    return uris, None


def document_to_llm_input(
    document_bytes: bytes, content_type: str, *, max_pages: int = _DEFAULT_MAX_PDF_PAGES
) -> tuple[str | None, object, str | None]:
    """Text-first, image-fallback. Returns `(mode, value, error)`:
    - `("text", str, None)` when the PDF has a solid embedded text layer (cheap path), or
    - `("images", list[str], None)` for scans/photos/non-PDF images, or
    - `(None, None, error)` on failure."""
    from app.services import pdf_text

    text = pdf_text.extract_text(document_bytes)
    if text and len(text.strip()) >= _MIN_TEXT_CHARS:
        return "text", text.strip(), None

    uris, err = document_to_image_uris(document_bytes, content_type, max_pages=max_pages)
    if err:
        return None, None, err
    return "images", uris, None


def build_content(base_prompt: str, mode: str, value: object) -> tuple[str, list[str]]:
    """Given an LLM input `(mode, value)` from `document_to_llm_input`, produce `(prompt, image_uris)`
    ready for `llm_completion` — inlining the document text for the text path, or attaching images."""
    if mode == "text":
        return f"{base_prompt}\n\n--- DOCUMENT TEXT ---\n{value}", []
    return base_prompt, list(value)  # type: ignore[arg-type]


def parse_json(text: str) -> dict | None:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                return None
    return None


def empty_meta(model_alias: str) -> dict:
    return {"usage": None, "request_id": None, "model": model_alias, "cost_usd": 0.0}


def llm_completion(
    virtual_key: str, model_alias: str, prompt: str, image_uris: list[str], timeout: float
) -> tuple[bool, str, dict | None, dict]:
    """Shared LiteLLM-proxy completion. Text-only when `image_uris` is empty, vision otherwise.
    Returns `(ok, message, parsed_json, meta)` where `meta = {usage, request_id, model, cost_usd}`
    for VS-15 usage attribution (`cost_usd` from the `x-litellm-response-cost` header)."""
    meta = empty_meta(model_alias)
    if image_uris:
        content: object = [{"type": "text", "text": prompt}] + [
            {"type": "image_url", "image_url": {"url": uri}} for uri in image_uris
        ]
    else:
        content = prompt
    payload = {"model": model_alias, "messages": [{"role": "user", "content": content}], "temperature": 0}

    try:
        with httpx.Client(base_url=settings.litellm_proxy_url, timeout=timeout) as client:
            resp = client.post("/chat/completions", headers={"Authorization": f"Bearer {virtual_key}"}, json=payload)
    except (httpx.ConnectError, httpx.TimeoutException) as exc:
        return False, f"Could not reach the LiteLLM proxy: {exc}", None, meta

    if resp.status_code >= 400:
        return (
            False,
            "The AI engine rejected the request. Its assigned model may not support "
            f"image/PDF understanding — assign a vision-capable model in AI Engine settings. ({resp.text[:200]})",
            None,
            meta,
        )

    try:
        body = resp.json()
        msg_content = body["choices"][0]["message"]["content"]
    except (KeyError, IndexError, ValueError):
        return False, "The AI engine returned an unexpected response shape.", None, meta

    meta["usage"] = body.get("usage")
    meta["request_id"] = body.get("id")
    try:
        meta["cost_usd"] = float(resp.headers.get("x-litellm-response-cost") or 0.0)
    except (TypeError, ValueError):
        meta["cost_usd"] = 0.0

    raw = parse_json(msg_content if isinstance(msg_content, str) else json.dumps(msg_content))
    if raw is None:
        return False, f"Could not parse structured data from the AI response: {str(msg_content)[:200]}", None, meta
    return True, "ok", raw, meta
