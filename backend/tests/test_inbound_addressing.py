"""Inbound local-part generation (no DB)."""

import re

from app.services.email_ingest.addressing import build_inbound_local_part


def test_local_part_is_slug_agent_short():
    lp = build_inbound_local_part("ibas", "ledger")
    assert re.fullmatch(r"ibas-ledger-[0-9a-f]{6}", lp)


def test_local_part_slugifies_and_defaults():
    # Messy tenant slug + empty agent → still a clean, routable local-part.
    lp = build_inbound_local_part("Big Co.", "")
    assert re.fullmatch(r"big-co-inbox-[0-9a-f]{6}", lp)
    assert build_inbound_local_part("", "decode").startswith("hq-decode-")


def test_local_part_is_unguessable_per_call():
    parts = {build_inbound_local_part("ibas", "ledger") for _ in range(50)}
    assert len(parts) == 50  # the random suffix makes each generated address distinct
