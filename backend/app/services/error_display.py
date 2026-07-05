"""Tenant-facing error message sanitization.

Playbooks surface real errors so a Commander knows what went wrong (e.g. "No AI engine
configured"). But some errors embed a raw provider payload for engineer debugging — e.g.
extraction.py's `f"... ({resp.text[:200]})"` — which reads as an ugly wall of JSON/stack-trace-like
text to a tenant and can leak internal endpoint details. `friendly_message` strips that trailing
technical blob for tenant-facing responses; Command Center (admin) always sees the raw message.
"""

import re

# Matches the exact "<friendly prefix> ({...raw payload...})" shape used across this codebase.
_TECH_BLOB_RE = re.compile(r"\s*\(\{.*$", re.DOTALL)

_FALLBACK = "An unexpected error occurred while running this step."


def friendly_message(raw: str | None) -> str | None:
    if raw is None:
        return None
    cleaned = _TECH_BLOB_RE.sub("", raw)
    # Defensive: also cut at the first newline (stack traces / multi-line payloads).
    cleaned = cleaned.split("\n", 1)[0].strip()
    return cleaned or _FALLBACK
