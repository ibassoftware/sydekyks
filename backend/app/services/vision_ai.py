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

    from app.services.pdfium_lock import PDFIUM_LOCK

    # pdfium is not thread-safe: serialize the whole open→render→close cycle across Missions.
    with PDFIUM_LOCK:
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


def strip_code_fences(text: str) -> str:
    """Drop a ```lang … ``` wrapper if a model added one despite instructions. For prose agents that
    emit a raw HTML fragment (not JSON), this is the whole cleanup — see `title_from_html`."""
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text)
    return text.strip()


def title_from_html(html: str) -> str:
    """Text of the leading <h1>/<h2>. Prose agents are told to open their fragment with one, so a
    document title can be derived without a second model call."""
    m = re.search(r"<h[12][^>]*>(.*?)</h[12]>", html, re.IGNORECASE | re.DOTALL)
    if not m:
        return ""
    return re.sub(r"<[^>]+>", "", m.group(1)).strip()[:255]


def empty_meta(model_alias: str) -> dict:
    return {"usage": None, "request_id": None, "model": model_alias, "cost_usd": 0.0}


def _message_content(prompt: str, image_uris: list[str]) -> object:
    """The `messages[0].content` payload — a plain string for text-only, or a text+images list."""
    if image_uris:
        return [{"type": "text", "text": prompt}] + [
            {"type": "image_url", "image_url": {"url": uri}} for uri in image_uris
        ]
    return prompt


_REJECTED_MSG = (
    "The AI engine rejected the request. Its assigned model may not support "
    "image/PDF understanding — assign a vision-capable model in AI Engine settings. ({body})"
)


def llm_stream(virtual_key: str, model_alias: str, prompt: str, image_uris: list[str], timeout: float):
    """The single streaming transport to the LiteLLM proxy — EVERY AI call rides this one path.
    Text-only when `image_uris` is empty, vision otherwise. Yields event dicts with a discriminated
    `type`:
      - `{"type": "delta", "text": str}`                          one content chunk (for live prose)
      - `{"type": "done",  "ok": True,  "text": str, "meta": {}}` full assembled text + usage/cost meta
      - `{"type": "error", "ok": False, "msg": str,  "meta": {}}` reach/reject/transport failure

    `meta` matches `empty_meta` (usage/request_id/model/cost_usd). Prose agents forward the deltas to
    the browser; structured/batch agents use `llm_completion`, which drains this to the terminal event
    and validates the whole assembled object before acting (never on a partial)."""
    meta = empty_meta(model_alias)
    payload = {
        "model": model_alias,
        "messages": [{"role": "user", "content": _message_content(prompt, image_uris)}],
        "temperature": 0,
        "stream": True,
        "stream_options": {"include_usage": True},  # usage arrives in the final chunk
    }
    parts: list[str] = []
    try:
        with httpx.Client(base_url=settings.litellm_proxy_url, timeout=timeout) as client:
            with client.stream(
                "POST", "/chat/completions",
                headers={"Authorization": f"Bearer {virtual_key}"}, json=payload,
            ) as resp:
                if resp.status_code >= 400:
                    resp.read()  # a streamed response must be read before `.text` is available
                    yield {"type": "error", "ok": False, "msg": _REJECTED_MSG.format(body=resp.text[:200]), "meta": meta}
                    return
                # Cost is a response header; may be absent on streaming — usage (final chunk) is the
                # reliable attribution signal, cost falls back to 0.0 for downstream pricing.
                try:
                    meta["cost_usd"] = float(resp.headers.get("x-litellm-response-cost") or 0.0)
                except (TypeError, ValueError):
                    meta["cost_usd"] = 0.0
                for line in resp.iter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    if chunk.get("id"):
                        meta["request_id"] = chunk["id"]
                    if chunk.get("usage"):
                        meta["usage"] = chunk["usage"]
                    for choice in chunk.get("choices") or []:
                        piece = (choice.get("delta") or {}).get("content")
                        if piece:
                            parts.append(piece)
                            yield {"type": "delta", "text": piece}
    except (httpx.ConnectError, httpx.TimeoutException) as exc:
        yield {"type": "error", "ok": False, "msg": f"Could not reach the LiteLLM proxy: {exc}", "meta": meta}
        return
    yield {"type": "done", "ok": True, "text": "".join(parts), "meta": meta}


def llm_completion(
    virtual_key: str, model_alias: str, prompt: str, image_uris: list[str], timeout: float
) -> tuple[bool, str, dict | None, dict]:
    """Buffered completion — drains the shared `llm_stream` transport, then parses the fully assembled
    text as JSON. This is the path for structured/batch agents that need the whole validated object
    before acting; the `stream: true` underneath is transparent to them. Returns
    `(ok, message, parsed_json, meta)` with `meta = {usage, request_id, model, cost_usd}` for usage
    attribution. Prose agents wanting live tokens consume `llm_stream` directly instead."""
    text = ""
    meta = empty_meta(model_alias)
    for event in llm_stream(virtual_key, model_alias, prompt, image_uris, timeout):
        if event["type"] == "delta":
            continue  # the full text is re-delivered in the terminal `done` event
        if event["type"] == "error":
            return False, event["msg"], None, event["meta"]
        text, meta = event["text"], event["meta"]  # done

    raw = parse_json(text)
    if raw is None:
        return False, f"Could not parse structured data from the AI response: {text[:200]}", None, meta
    return True, "ok", raw, meta
