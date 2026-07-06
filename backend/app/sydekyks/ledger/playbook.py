"""Ledger's vendor-bill ingestion playbook — registered under 'ledger.vendor_bill_ingest'.

Each step is recorded via the generic `record_step` so the Mission is a full audit trail.
"""

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.core.crypto import decrypt_secret
from app.models.gadget import TenantGadgetLink
from app.models.gadget_requirement import SydekykGadgetRequirement, TenantSydekykGadgetAssignment
from app.models.llm_provider import TenantSydekykLLMConfig
from app.models.mission import Mission, MissionDocument
from app.services import document_storage, odoo
from app.services.missions import record_step, register_playbook

from app.sydekyks.ledger import confidence, duplicates, extraction, narration, odoo_bills
from app.sydekyks.ledger.models import LedgerTenantSettings

PLAYBOOK_KEY = "ledger.vendor_bill_ingest"

# Read-only, human-facing description of the fixed Playbook (VS-5). Single source of truth: the
# `key`s here MUST match the step_keys `run()` records below, and a test asserts that invariant.
PLAYBOOK_STEPS = [
    {"key": "classify_document", "title": "Check it's actually a bill",
     "description": "Quick check that the uploaded document is a vendor bill/invoice/receipt before running full extraction.",
     "likely_failures": "The document doesn't look like a bill (e.g. a random photo, resume, or unrelated file) — Mission fails immediately, no Odoo bill created."},
    {"key": "extract_bill_data", "title": "Extract bill data",
     "description": "Read the uploaded/emailed bill with the assigned vision model and pull vendor, invoice number, dates, totals and line items.",
     "likely_failures": "AI engine not configured, or the model can't read images/PDFs."},
    {"key": "connect_odoo", "title": "Connect to Odoo",
     "description": "Open an authenticated session to the Odoo instance assigned to Ledger.",
     "likely_failures": "No Odoo assigned, wrong credentials, or Odoo unreachable."},
    {"key": "lookup_vendor", "title": "Find or create the vendor",
     "description": "Match the extracted vendor to an Odoo partner; optionally create it when auto-create is on.",
     "likely_failures": "Vendor not found and auto-create disabled (marked needs-review)."},
    {"key": "duplicate_check", "title": "Duplicate check",
     "description": "Look for an existing bill with the same invoice number (or a near-match by amount) to avoid double entry.",
     "likely_failures": "None fatal — a suspected duplicate is flagged for review."},
    {"key": "infer_account", "title": "Infer the expense account",
     "description": "Reuse the vendor's historical account, else fall back to a default expense account.",
     "likely_failures": "No expense account available in Odoo."},
    {"key": "resolve_currency", "title": "Resolve currency",
     "description": "Match the bill's stated currency to an enabled Odoo currency, so the bill is created in the right denomination.",
     "likely_failures": "The stated currency isn't enabled in Odoo (marked needs-review, no bill created)."},
    {"key": "resolve_tax", "title": "Resolve tax",
     "description": "Apply the expense account's default purchase tax, if one is configured.",
     "likely_failures": "The bill has tax but no matching tax is configured in Odoo (bill created as a draft, flagged for review, never auto-posted)."},
    {"key": "create_bill", "title": "Create the vendor bill",
     "description": "Compute a confidence score and create the draft bill in Odoo with its line items and narration.",
     "likely_failures": "Required Odoo fields unmet (marked needs-review) or an Odoo error."},
    {"key": "attach_document", "title": "Attach the original document",
     "description": "Attach the originally uploaded bill (PDF/image) to the Odoo record as evidence, so a human can compare it against the extracted data.",
     "likely_failures": "Best-effort — an attachment failure never fails the Mission; the bill itself is already created."},
    {"key": "post_bill", "title": "Post when confident",
     "description": "If confidence meets the auto-post threshold, post the bill; otherwise leave it as a draft for a human.",
     "likely_failures": "Odoo rejects posting; bill stays draft."},
]


def _finish(
    db: Session,
    mission: Mission,
    status: str,
    summary: dict,
    error: str | None = None,
    failure_category: str | None = None,
) -> None:
    mission.status = status
    mission.result_summary = summary
    mission.error_message = error
    # Classify failures so the queue's retry policy (VS-7) reads a field, never the error string.
    mission.failure_category = failure_category if status == "failed" else None
    mission.completed_at = datetime.now(timezone.utc)
    db.commit()


def _emit_usage(db: Session, mission: Mission, llm, meta: dict) -> None:
    """Best-effort usage attribution — never let a usage-logging hiccup fail the Mission."""
    try:
        from app.services import usage_events

        usage_events.record_usage(
            db,
            tenant_id=mission.tenant_id,
            sydekyk_id=mission.sydekyk_id,
            mission_id=mission.id,
            provider=llm.provider,
            model=llm.litellm_model_alias,
            usage=meta.get("usage"),
            litellm_request_id=meta.get("request_id"),
            cost_usd=float(meta.get("cost_usd") or 0.0),
        )
    except Exception:  # noqa: BLE001 — usage logging is non-critical to the AP workflow
        db.rollback()


def _get_ledger_settings(db: Session, tenant_id) -> LedgerTenantSettings:
    s = db.query(LedgerTenantSettings).filter(LedgerTenantSettings.tenant_id == tenant_id).first()
    if s is None:
        s = LedgerTenantSettings(tenant_id=tenant_id)
        db.add(s)
        db.commit()
        db.refresh(s)
    return s


def _get_odoo_link(db: Session, mission: Mission) -> TenantGadgetLink | None:
    """The tenant's Odoo Gadget Link assigned to Ledger's 'erp' requirement."""
    req = (
        db.query(SydekykGadgetRequirement)
        .filter(SydekykGadgetRequirement.sydekyk_id == mission.sydekyk_id, SydekykGadgetRequirement.role_key == "erp")
        .first()
    )
    if req is None:
        return None
    assignment = (
        db.query(TenantSydekykGadgetAssignment)
        .filter(
            TenantSydekykGadgetAssignment.tenant_id == mission.tenant_id,
            TenantSydekykGadgetAssignment.requirement_id == req.id,
        )
        .first()
    )
    if assignment is None:
        return None
    link = db.get(TenantGadgetLink, assignment.gadget_link_id)
    # Re-verify tenant ownership across the request/background boundary.
    if link is None or link.tenant_id != mission.tenant_id:
        return None
    return link


def run(db: Session, mission: Mission) -> None:
    idx = 0
    document = db.query(MissionDocument).filter(MissionDocument.mission_id == mission.id).first()
    document_bytes = document_storage.read_content(document)
    if document is None or document_bytes is None:
        record_step(db, mission, idx, "load_document", "internal", "failed", error="Document bytes missing")
        _finish(db, mission, "failed", {}, "Document bytes missing", failure_category="validation")
        return

    settings = _get_ledger_settings(db, mission.tenant_id)

    # --- Step 1: classify — is this actually a bill? -----------------------------------------------
    llm = (
        db.query(TenantSydekykLLMConfig)
        .filter(
            TenantSydekykLLMConfig.tenant_id == mission.tenant_id,
            TenantSydekykLLMConfig.sydekyk_id == mission.sydekyk_id,
        )
        .first()
    )
    if llm is None or not llm.litellm_virtual_key_encrypted or not llm.litellm_model_alias:
        record_step(db, mission, idx, "classify_document", "llm_call", "failed",
                    error="No AI engine configured for Ledger. Pick one in the Roster AI Engine section.")
        _finish(db, mission, "failed", {}, "No AI engine configured", failure_category="setup")
        return
    virtual_key = decrypt_secret(llm.litellm_virtual_key_encrypted)

    # Rasterize once (PDF pages -> PNG, capped at 3) and reuse for both the classify and extract
    # calls — avoids rendering a multi-page PDF twice.
    image_uris, img_err = extraction.document_to_image_uris(document_bytes, document.content_type)
    if img_err:
        record_step(db, mission, idx, "classify_document", "internal", "failed", error=img_err)
        _finish(db, mission, "failed", {}, img_err, failure_category="validation")
        return

    ok, msg, classification, meta = extraction.classify_document(virtual_key, llm.litellm_model_alias, image_uris)
    # VS-15: attribute this hosted-AI call to (tenant, sydekyk, mission), keyed by request id.
    _emit_usage(db, mission, llm, meta)
    if not ok or classification is None:
        record_step(db, mission, idx, "classify_document", "llm_call", "failed", error=msg)
        _finish(db, mission, "failed", {}, msg, failure_category="transient")
        return
    if not classification.is_bill:
        reason = (
            f"This doesn't look like a vendor bill (looks like: "
            f"{classification.document_type_guess or 'unrecognized document'}). {classification.reason}"
        ).strip()
        record_step(db, mission, idx, "classify_document", "llm_call", "failed", error=reason, output={
            "is_bill": False, "document_type_guess": classification.document_type_guess})
        _finish(db, mission, "failed", {}, reason, failure_category="validation")
        return
    record_step(db, mission, idx, "classify_document", "llm_call", "succeeded", output={
        "is_bill": True, "document_type_guess": classification.document_type_guess})
    idx += 1

    # --- Step 2: extract bill data via the tenant's assigned AI engine -----------------------------
    ok, msg, bill, meta = extraction.extract_bill_data(virtual_key, llm.litellm_model_alias, image_uris)
    _emit_usage(db, mission, llm, meta)
    if not ok or bill is None:
        record_step(db, mission, idx, "extract_bill_data", "llm_call", "failed", error=msg)
        # Provider/proxy reachability or model rejection — the queue may retry transient cases.
        _finish(db, mission, "failed", {}, msg, failure_category="transient")
        return
    record_step(db, mission, idx, "extract_bill_data", "llm_call", "succeeded", output={
        "vendor_name": bill.vendor_name, "invoice_number": bill.invoice_number,
        "invoice_date": bill.invoice_date, "total": bill.total, "currency": bill.currency,
        "llm_confidence": bill.llm_confidence,
    })
    idx += 1

    # --- Step 2: connect to Odoo -----------------------------------------------------------------
    link = _get_odoo_link(db, mission)
    if link is None:
        record_step(db, mission, idx, "connect_odoo", "gadget_call", "failed",
                    error="No Odoo instance assigned to Ledger. Assign one in Ledger's settings.")
        _finish(db, mission, "failed", {"vendor_name": bill.vendor_name}, "No Odoo instance assigned",
                failure_category="setup")
        return
    ok, msg, client = odoo.connect(link.url, link.database, link.username, decrypt_secret(link.encrypted_secret))
    if not ok or client is None:
        record_step(db, mission, idx, "connect_odoo", "gadget_call", "failed", error=msg)
        _finish(db, mission, "failed", {"vendor_name": bill.vendor_name}, msg, failure_category="external")
        return
    record_step(db, mission, idx, "connect_odoo", "gadget_call", "succeeded", output={"instance": link.name})
    idx += 1

    try:
        # --- Step 3: find / create vendor partner -----------------------------------------------
        partner = odoo.find_partner(client, bill.vendor_name)
        partner_matched_exact = bool(partner and partner["name"].strip().lower() == bill.vendor_name.strip().lower())
        partner_auto_created = False
        if partner is None:
            if not settings.auto_create_partner:
                record_step(db, mission, idx, "lookup_vendor", "gadget_call", "succeeded", output={
                    "found": False, "action": "needs_review", "reason": "auto_create_partner disabled"})
                _finish(db, mission, "succeeded", {
                    "vendor_name": bill.vendor_name, "invoice_number": bill.invoice_number,
                    "total": bill.total, "currency": bill.currency, "needs_review": True,
                    "review_reason": f"Vendor '{bill.vendor_name}' not found in Odoo and auto-create is off.",
                    "posted": False, "duplicate": False,
                })
                return
            partner_id = odoo.create_partner(client, bill.vendor_name)
            partner_auto_created = True
            record_step(db, mission, idx, "lookup_vendor", "gadget_call", "succeeded", output={
                "found": False, "created_partner_id": partner_id})
        else:
            partner_id = partner["id"]
            record_step(db, mission, idx, "lookup_vendor", "gadget_call", "succeeded", output={
                "found": True, "partner_id": partner_id, "exact": partner_matched_exact})
        idx += 1

        # --- Step 4: duplicate check ------------------------------------------------------------
        exact = odoo_bills.find_duplicate_bills(client, partner_id, bill.invoice_number) if bill.invoice_number else []
        near = [] if bill.invoice_number else odoo_bills.find_bills_near(client, partner_id, bill.total)
        dup = duplicates.check_duplicate(bill.invoice_number, exact, near)
        record_step(db, mission, idx, "duplicate_check", "gadget_call", "succeeded", output={
            "is_duplicate": dup.is_duplicate, "reason": dup.reason,
            "matched": dup.matched_move.get("name") if dup.matched_move else None})
        idx += 1
        if dup.is_duplicate:
            _finish(db, mission, "succeeded", {
                "vendor_name": bill.vendor_name, "invoice_number": bill.invoice_number,
                "total": bill.total, "currency": bill.currency, "duplicate": True,
                "duplicate_of": dup.matched_move.get("name") if dup.matched_move else None,
                "posted": False, "needs_review": True,
                "review_reason": "Looks like a duplicate of an existing Odoo bill.",
            })
            return

        # --- Step 5: infer expense account ------------------------------------------------------
        account_id = odoo_bills.get_historical_account_id(client, partner_id)
        account_source = "history" if account_id else "guessed"
        if account_id is None:
            account_id = odoo_bills.default_expense_account_id(client)
        if account_id is None:
            record_step(db, mission, idx, "infer_account", "gadget_call", "failed",
                        error="No expense account available in Odoo")
            _finish(db, mission, "failed", {"vendor_name": bill.vendor_name}, "No expense account available",
                    failure_category="validation")
            return
        record_step(db, mission, idx, "infer_account", "gadget_call", "succeeded", output={
            "account_id": account_id, "source": account_source})
        idx += 1

        # --- Step 6: resolve currency (currency-aware) ------------------------------------------
        # A PDF/image bill states its currency; Odoo previously always defaulted to the company's
        # currency regardless — silently wrong for any bill not in that currency. Resolve the
        # extracted ISO code to an Odoo res.currency id, or refuse to create a (mis-denominated)
        # bill rather than guess.
        currency_id = None
        if bill.currency:
            currency_id = odoo.find_currency_id(client, bill.currency)
            if currency_id is None:
                record_step(db, mission, idx, "resolve_currency", "gadget_call", "succeeded", output={
                    "requested": bill.currency, "resolved": False})
                idx += 1
                _finish(db, mission, "succeeded", {
                    "vendor_name": bill.vendor_name, "invoice_number": bill.invoice_number,
                    "total": bill.total, "currency": bill.currency, "posted": False, "duplicate": False,
                    "needs_review": True,
                    "review_reason": f"Currency '{bill.currency}' isn't enabled in Odoo — needs manual review.",
                })
                return
            record_step(db, mission, idx, "resolve_currency", "gadget_call", "succeeded", output={
                "requested": bill.currency, "resolved": True, "currency_id": currency_id})
        else:
            record_step(db, mission, idx, "resolve_currency", "gadget_call", "succeeded", output={
                "requested": None, "resolved": False, "note": "No currency extracted — Odoo default applies"})
        idx += 1

        # --- Step 7: resolve tax (tax-aware) -----------------------------------------------------
        # If the bill states tax but the expense account has no default purchase tax configured,
        # still create the draft (the line amounts are correct) but never auto-post it, and flag a
        # standing tenant Issue — this is an Odoo configuration gap, not a one-off bill problem.
        tax_ids = odoo_bills.get_account_default_taxes(client, account_id)
        tax_needs_review = False
        tax_review_reason: str | None = None
        if tax_ids:
            record_step(db, mission, idx, "resolve_tax", "gadget_call", "succeeded", output={
                "tax_ids": tax_ids, "source": "account_default"})
        elif bill.tax_amount and bill.tax_amount > 0:
            any_purchase_tax = odoo_bills.has_purchase_taxes_configured(client)
            tax_review_reason = (
                "This bill includes tax, but the expense account has no default purchase tax in Odoo."
                if any_purchase_tax else
                "This bill includes tax, but this Odoo instance has no purchase taxes configured at all."
            )
            record_step(db, mission, idx, "resolve_tax", "gadget_call", "succeeded", output={
                "tax_ids": [], "source": "none", "flagged": True, "reason": tax_review_reason})
            tax_needs_review = True
            from app.services import tenant_issues
            tenant_issues.report_issue(
                db, tenant_id=mission.tenant_id, sydekyk_id=mission.sydekyk_id,
                kind="missing_tax_config", title="Ledger flagged a bill with no matching tax configuration",
                detail=tax_review_reason, mission_id=mission.id,
            )
        else:
            record_step(db, mission, idx, "resolve_tax", "gadget_call", "succeeded", output={
                "tax_ids": [], "source": "none", "flagged": False})
        idx += 1

        # --- Step 8: compute confidence + create bill -------------------------------------------
        score = confidence.compute_confidence(
            bill.llm_confidence, partner_matched_exact=partner_matched_exact,
            partner_auto_created=partner_auto_created, account_source=account_source,
            duplicate_check="clear")
        # Auto-post is opt-in (auto_post_enabled) and additionally never fires when tax config is
        # missing — posting a bill with an unrepresented tax liability is a compliance risk we
        # don't take automatically.
        will_post = settings.auto_post_enabled and not tax_needs_review and score >= settings.auto_post_threshold
        note = narration.build_narration(score, account_source, will_post)

        line_items = [
            {"description": li.description, "quantity": li.quantity, "unit_price": li.unit_price, "amount": li.amount}
            for li in bill.line_items
        ]
        ok, msg, move_id, unmet = odoo_bills.create_vendor_bill(
            client, partner_id=partner_id, invoice_number=bill.invoice_number,
            invoice_date=bill.invoice_date, account_id=account_id, line_items=line_items, narration=note,
            currency_id=currency_id, tax_ids=tax_ids or None)
        if not ok:
            record_step(db, mission, idx, "create_bill", "gadget_call", "failed", error=msg,
                        output={"unmet_required_fields": unmet})
            _finish(db, mission, "succeeded" if unmet else "failed", {
                "vendor_name": bill.vendor_name, "invoice_number": bill.invoice_number,
                "total": bill.total, "currency": bill.currency, "posted": False,
                "needs_review": bool(unmet), "review_reason": msg,
            }, None if unmet else msg, failure_category=None if unmet else "external")
            return
        record_step(db, mission, idx, "create_bill", "gadget_call", "succeeded", output={
            "odoo_move_id": move_id, "confidence": score})
        idx += 1

        # --- Step 9: attach the original document (best-effort — never fails the Mission) --------
        # The bill was already created correctly; a failed attachment is a nice-to-have miss, not a
        # reason to mark a successful bill-creation Mission as failed.
        attach_ok, attach_msg = odoo_bills.attach_document(
            client, move_id=move_id, filename=document.filename,
            content_bytes=document_bytes, mimetype=document.content_type,
        )
        record_step(db, mission, idx, "attach_document", "gadget_call", "succeeded" if attach_ok else "failed",
                    error=None if attach_ok else attach_msg)
        idx += 1

        # --- Step 10: optional auto-post ---------------------------------------------------------
        posted = False
        if will_post:
            ok, msg = odoo_bills.post_bill(client, move_id)
            posted = ok
            record_step(db, mission, idx, "post_bill", "gadget_call", "succeeded" if ok else "failed",
                        error=None if ok else msg, output={"posted": ok})
            idx += 1

        bill_row = odoo_bills.read_bill(client, move_id)
        _finish(db, mission, "succeeded", {
            "vendor_name": bill.vendor_name, "invoice_number": bill.invoice_number,
            "total": bill.total, "currency": bill.currency, "confidence": score,
            "odoo_move_id": move_id, "odoo_move_name": bill_row.get("name") if bill_row else None,
            "posted": posted, "duplicate": False,
            "needs_review": tax_needs_review, "review_reason": tax_review_reason,
        })
    except odoo.OdooError as exc:
        record_step(db, mission, idx, "odoo_error", "gadget_call", "failed", error=str(exc))
        _finish(db, mission, "failed", {"vendor_name": bill.vendor_name}, str(exc), failure_category="external")


register_playbook(PLAYBOOK_KEY, run)
