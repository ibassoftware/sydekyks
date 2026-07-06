import base64
import io
import json
import re
from dataclasses import dataclass, field

import httpx

from app.core.config import settings

# Vision models accept raster images, not PDFs — a PDF sent as an image_url is rejected with
# "invalid image input". So a PDF is rasterized to PNG page images before the vision call. Cap the
# page count: invoices are almost always 1-2 pages, and each page is another (billable) image.
_MAX_PDF_PAGES = 3
_PDF_RENDER_SCALE = 2.5  # ~180 DPI — enough for the model to read invoice text


def _b64_data_uri(content_type: str, raw: bytes) -> str:
    return f"data:{content_type};base64,{base64.b64encode(raw).decode('ascii')}"


def document_to_image_uris(document_bytes: bytes, content_type: str) -> tuple[list[str], str | None]:
    """Turn the uploaded document into a list of image data URIs the vision model can read.
    Images pass straight through; PDFs are rasterized page-by-page to PNG (capped at
    _MAX_PDF_PAGES). Called once per Mission and the result reused for both the classification and
    extraction calls, so a multi-page PDF isn't rasterized twice."""
    is_pdf = content_type == "application/pdf" or document_bytes[:5] == b"%PDF-"
    if not is_pdf:
        return [_b64_data_uri(content_type or "image/png", document_bytes)], None

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
        for i in range(min(len(pdf), _MAX_PDF_PAGES)):
            bitmap = pdf[i].render(scale=_PDF_RENDER_SCALE)
            buf = io.BytesIO()
            bitmap.to_pil().save(buf, format="PNG")
            uris.append(_b64_data_uri("image/png", buf.getvalue()))
    finally:
        pdf.close()
    if not uris:
        return [], "The PDF had no rasterizable pages."
    return uris, None


_CLASSIFY_PROMPT = """You are Ledger, an accounts-payable assistant. Look at the attached image(s) \
and decide whether this is a vendor bill / invoice / receipt for goods or services — i.e. something \
that should become an Odoo vendor bill. Respond with ONLY a JSON object (no prose, no markdown \
fences) with exactly these keys:

{
  "is_bill": boolean,
  "document_type_guess": short string describing what the document actually is (e.g. "invoice", "receipt", "photo", "resume", "contract", "blank page"),
  "reason": short string explaining your answer
}

Err on the side of "is_bill": true for anything that plausibly represents a purchase or expense \
owed to a vendor, even if some fields are missing, blurry, or unusually formatted. Only answer \
false for content that is clearly NOT a bill — e.g. an unrelated photo, a letter, a contract, a \
resume, an ID card, a blank/unreadable page, or a screenshot unrelated to a purchase."""

_EXTRACTION_PROMPT = """You are Ledger, a meticulous accounts-payable assistant. You are given an \
image of a single vendor bill / invoice. Extract its data and respond with ONLY a JSON object \
(no prose, no markdown fences) with exactly these keys:

{
  "vendor_name": string,
  "vendor_tax_id": string or null,
  "invoice_number": string or null,
  "invoice_date": "YYYY-MM-DD" or null,
  "currency": 3-letter ISO code or null,
  "line_items": [{"description": string, "quantity": number, "unit_price": number, "amount": number}],
  "subtotal": number or null,
  "tax_amount": number or null,
  "total": number,
  "llm_confidence": integer 0-100 (your confidence in this extraction),
  "llm_confidence_reason": short string
}

If a field is not present on the bill, use null (or an empty array for line_items). Never invent values."""


@dataclass
class DocumentClassification:
    is_bill: bool
    document_type_guess: str = ""
    reason: str = ""


@dataclass
class BillLineItem:
    description: str
    quantity: float
    unit_price: float
    amount: float


@dataclass
class BillExtraction:
    vendor_name: str
    total: float
    line_items: list[BillLineItem] = field(default_factory=list)
    vendor_tax_id: str | None = None
    invoice_number: str | None = None
    invoice_date: str | None = None
    currency: str | None = None
    subtotal: float | None = None
    tax_amount: float | None = None
    llm_confidence: int = 0
    llm_confidence_reason: str = ""


def _parse_json(text: str) -> dict | None:
    text = text.strip()
    # Strip markdown fences if the model added them despite instructions.
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Last resort: grab the outermost {...} block.
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                return None
    return None


def _coerce(raw: dict) -> BillExtraction:
    items = []
    for li in raw.get("line_items") or []:
        try:
            items.append(
                BillLineItem(
                    description=str(li.get("description") or "Item"),
                    quantity=float(li.get("quantity") or 1),
                    unit_price=float(li.get("unit_price") or 0),
                    amount=float(li.get("amount") or 0),
                )
            )
        except (TypeError, ValueError):
            continue
    return BillExtraction(
        vendor_name=str(raw.get("vendor_name") or "Unknown Vendor"),
        total=float(raw.get("total") or 0),
        line_items=items,
        vendor_tax_id=raw.get("vendor_tax_id") or None,
        invoice_number=(str(raw["invoice_number"]) if raw.get("invoice_number") else None),
        invoice_date=raw.get("invoice_date") or None,
        currency=(str(raw["currency"]).upper() if raw.get("currency") else None),
        subtotal=(float(raw["subtotal"]) if raw.get("subtotal") is not None else None),
        tax_amount=(float(raw["tax_amount"]) if raw.get("tax_amount") is not None else None),
        llm_confidence=int(raw.get("llm_confidence") or 0),
        llm_confidence_reason=str(raw.get("llm_confidence_reason") or ""),
    )


def _coerce_classification(raw: dict) -> DocumentClassification:
    return DocumentClassification(
        is_bill=bool(raw.get("is_bill")),
        document_type_guess=str(raw.get("document_type_guess") or ""),
        reason=str(raw.get("reason") or ""),
    )


def _empty_meta(model_alias: str) -> dict:
    return {"usage": None, "request_id": None, "model": model_alias, "cost_usd": 0.0}


def _vision_completion(
    virtual_key: str, model_alias: str, prompt: str, image_uris: list[str], timeout: float
) -> tuple[bool, str, dict | None, dict]:
    """Shared LiteLLM vision-completion plumbing used by both classify_document and
    extract_bill_data: sends `prompt` + `image_uris`, parses the JSON response, and captures
    usage/cost/request_id for VS-15 attribution. Callers coerce the parsed JSON into their own
    result dataclass. No pre-check of vision support — we let the provider reject it and surface a
    clear message, since BYOK model strings are freeform."""
    meta = _empty_meta(model_alias)
    content = [{"type": "text", "text": prompt}]
    content += [{"type": "image_url", "image_url": {"url": uri}} for uri in image_uris]
    payload = {"model": model_alias, "messages": [{"role": "user", "content": content}], "temperature": 0}

    try:
        with httpx.Client(base_url=settings.litellm_proxy_url, timeout=timeout) as client:
            resp = client.post(
                "/chat/completions", headers={"Authorization": f"Bearer {virtual_key}"}, json=payload
            )
    except (httpx.ConnectError, httpx.TimeoutException) as exc:
        return False, f"Could not reach the LiteLLM proxy: {exc}", None, meta

    if resp.status_code >= 400:
        return (
            False,
            "The AI engine rejected the document. Its assigned model may not support image/PDF "
            f"understanding — assign a vision-capable model in AI Engine settings. ({resp.text[:200]})",
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
    # LiteLLM computes per-call cost and returns it in this header (present for priced providers;
    # absent/0 for custom endpoints like Ollama Cloud). This is what VS-15 attributes + reconciles.
    try:
        meta["cost_usd"] = float(resp.headers.get("x-litellm-response-cost") or 0.0)
    except (TypeError, ValueError):
        meta["cost_usd"] = 0.0

    raw = _parse_json(msg_content if isinstance(msg_content, str) else json.dumps(msg_content))
    if raw is None:
        return False, f"Could not parse structured data from the AI response: {str(msg_content)[:200]}", None, meta

    return True, "ok", raw, meta


def classify_document(
    virtual_key: str, model_alias: str, image_uris: list[str], timeout: float = 45.0
) -> tuple[bool, str, DocumentClassification | None, dict]:
    """Cheap pre-check run before the full extraction call: is this actually a bill? Prevents
    Ledger from hallucinating a plausible-looking BillExtraction out of an unrelated document
    (a photo, a resume, a contract, ...)."""
    ok, msg, raw, meta = _vision_completion(virtual_key, model_alias, _CLASSIFY_PROMPT, image_uris, timeout)
    if not ok or raw is None:
        return ok, msg, None, meta
    return True, "ok", _coerce_classification(raw), meta


def extract_bill_data(
    virtual_key: str, model_alias: str, image_uris: list[str], timeout: float = 90.0
) -> tuple[bool, str, BillExtraction | None, dict]:
    """Vision completion through the tenant's assigned engine (via its LiteLLM virtual key).
    Returns (ok, message, extraction, meta) where meta carries {usage, request_id, model, cost_usd}
    for billing-grade usage attribution (VS-15)."""
    ok, msg, raw, meta = _vision_completion(virtual_key, model_alias, _EXTRACTION_PROMPT, image_uris, timeout)
    if not ok or raw is None:
        return ok, msg, None, meta
    return True, "ok", _coerce(raw), meta
