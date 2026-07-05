import base64
import json
import re
from dataclasses import dataclass, field

import httpx

from app.core.config import settings

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


def extract_bill_data(
    virtual_key: str, model_alias: str, document_bytes: bytes, content_type: str, timeout: float = 90.0
) -> tuple[bool, str, BillExtraction | None, dict]:
    """Vision completion through the tenant's assigned engine (via its LiteLLM virtual key).
    Returns (ok, message, extraction, meta) where meta carries {usage, request_id, model} for
    billing-grade usage attribution (VS-15). No pre-check of vision support — we let the provider
    reject it and surface a clear message, since BYOK model strings are freeform."""
    meta: dict = {"usage": None, "request_id": None, "model": model_alias, "cost_usd": 0.0}
    data_uri = f"data:{content_type};base64,{base64.b64encode(document_bytes).decode('ascii')}"
    payload = {
        "model": model_alias,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": _EXTRACTION_PROMPT},
                    {"type": "image_url", "image_url": {"url": data_uri}},
                ],
            }
        ],
        "temperature": 0,
    }

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
        content = body["choices"][0]["message"]["content"]
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

    raw = _parse_json(content if isinstance(content, str) else json.dumps(content))
    if raw is None:
        return False, f"Could not parse structured data from the AI response: {str(content)[:200]}", None, meta

    return True, "ok", _coerce(raw), meta
