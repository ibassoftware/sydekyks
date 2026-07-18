"""Signet's signing-email copy - a deterministic template path (always available) and an optional
AI-written path (grounded in an optional "what to say" prompt). The AI path is metered like any other
model call; the template is the guaranteed fallback when AI is off or unavailable.
"""

import html as _html

from app.services import vision_ai

_WRAP = (
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1a1a1a;line-height:1.55;">'
    "{body}"
    '<p style="margin-top:24px;"><a href="{link}" style="background:#1e3a5f;color:#fff;'
    'padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block;">Review &amp; sign</a></p>'
    '<p style="color:#888;font-size:12px;margin-top:20px;">If the button doesn\'t work, paste this link '
    'into your browser:<br>{link}</p></div>'
)


def _render(body_html: str, link: str) -> str:
    return _WRAP.format(body=body_html, link=link)


def invite_template(*, signer_name: str, title: str, sender: str, note: str) -> tuple[str, str]:
    """Returns (subject, html) for the first invitation."""
    subject = f"Signature requested: {title}"
    greeting = f"Hi {_html.escape(signer_name)}," if signer_name else "Hello,"
    note_html = f"<p>{_html.escape(note)}</p>" if note else ""
    body = (
        f"<p>{greeting}</p>"
        f"<p>{_html.escape(sender)} has requested your signature on <strong>{_html.escape(title)}</strong>.</p>"
        f"{note_html}"
        "<p>Please review the document and sign at your convenience.</p>"
    )
    return subject, body


def reminder_template(*, signer_name: str, title: str, sender: str, reminder_number: int) -> tuple[str, str]:
    """Returns (subject, html) for a reminder; tone firms up as reminder_number grows."""
    subject = f"Reminder: please sign {title}"
    greeting = f"Hi {_html.escape(signer_name)}," if signer_name else "Hello,"
    if reminder_number >= 3:
        lead = "This is a final reminder that your signature is still needed on"
    elif reminder_number == 2:
        lead = "We wanted to follow up again - your signature is still needed on"
    else:
        lead = "A quick reminder that your signature is still needed on"
    body = (
        f"<p>{greeting}</p>"
        f"<p>{lead} <strong>{_html.escape(title)}</strong>, requested by {_html.escape(sender)}.</p>"
        "<p>It only takes a moment.</p>"
    )
    return subject, body


_AI_TEMPLATE = """You are Signet, writing a short, courteous {kind} email asking someone to sign a \
document. Keep it to 2-4 short sentences, professional and warm. Do NOT include a greeting line (the \
system prepends "Hi <name>,"), and do NOT include a signing link or a button (the system adds that). \
Do NOT invent facts.

Signer name: {signer_name}
Document title: {title}
Requested by: {sender}
{extra}
Additional instruction from the sender (optional): {prompt}

Respond with ONLY a JSON object (no prose, no markdown fences):
{{"subject": "the email subject line", "body_html": "the email body as simple HTML paragraphs"}}"""


def ai_copy(virtual_key, model_alias, *, kind, signer_name, title, sender, prompt, extra="", timeout: float = 120.0):
    """Returns (ok, {subject, body_html} | None, meta). `kind` is 'invitation' or 'reminder'."""
    full = _AI_TEMPLATE.format(
        kind=kind, signer_name=signer_name or "(unknown)", title=title, sender=sender,
        prompt=(prompt or "(none)").strip(), extra=extra,
    )
    ok, msg, raw, meta = vision_ai.llm_completion(virtual_key, model_alias, full, [], timeout)
    if not ok or raw is None:
        return False, None, meta
    subject = str(raw.get("subject") or "").strip()
    body = str(raw.get("body_html") or "").strip()
    if not subject or not body:
        return False, None, meta
    return True, {"subject": subject, "body_html": body}, meta


def wrap_body(body_html: str, link: str) -> str:
    """Wrap an (AI or template) body in the branded shell + the signing button."""
    return _render(body_html, link)
