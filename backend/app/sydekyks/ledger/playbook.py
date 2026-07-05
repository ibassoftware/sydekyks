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
from app.services import odoo
from app.services.missions import record_step, register_playbook

from app.sydekyks.ledger import confidence, duplicates, extraction, narration, odoo_bills
from app.sydekyks.ledger.models import LedgerTenantSettings

PLAYBOOK_KEY = "ledger.vendor_bill_ingest"


def _finish(db: Session, mission: Mission, status: str, summary: dict, error: str | None = None) -> None:
    mission.status = status
    mission.result_summary = summary
    mission.error_message = error
    mission.completed_at = datetime.now(timezone.utc)
    db.commit()


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
    if document is None or document.content is None:
        record_step(db, mission, idx, "load_document", "internal", "failed", error="Document bytes missing")
        _finish(db, mission, "failed", {}, "Document bytes missing")
        return

    settings = _get_ledger_settings(db, mission.tenant_id)

    # --- Step 1: extract bill data via the tenant's assigned AI engine ---------------------------
    llm = (
        db.query(TenantSydekykLLMConfig)
        .filter(
            TenantSydekykLLMConfig.tenant_id == mission.tenant_id,
            TenantSydekykLLMConfig.sydekyk_id == mission.sydekyk_id,
        )
        .first()
    )
    if llm is None or not llm.litellm_virtual_key_encrypted or not llm.litellm_model_alias:
        record_step(db, mission, idx, "extract_bill_data", "llm_call", "failed",
                    error="No AI engine configured for Ledger. Pick one in the Roster AI Engine section.")
        _finish(db, mission, "failed", {}, "No AI engine configured")
        return

    virtual_key = decrypt_secret(llm.litellm_virtual_key_encrypted)
    ok, msg, bill = extraction.extract_bill_data(virtual_key, llm.litellm_model_alias, document.content, document.content_type)
    if not ok or bill is None:
        record_step(db, mission, idx, "extract_bill_data", "llm_call", "failed", error=msg)
        _finish(db, mission, "failed", {}, msg)
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
        _finish(db, mission, "failed", {"vendor_name": bill.vendor_name}, "No Odoo instance assigned")
        return
    ok, msg, client = odoo.connect(link.url, link.database, link.username, decrypt_secret(link.encrypted_secret))
    if not ok or client is None:
        record_step(db, mission, idx, "connect_odoo", "gadget_call", "failed", error=msg)
        _finish(db, mission, "failed", {"vendor_name": bill.vendor_name}, msg)
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
            _finish(db, mission, "failed", {"vendor_name": bill.vendor_name}, "No expense account available")
            return
        record_step(db, mission, idx, "infer_account", "gadget_call", "succeeded", output={
            "account_id": account_id, "source": account_source})
        idx += 1

        # --- Step 6: compute confidence + create bill -------------------------------------------
        score = confidence.compute_confidence(
            bill.llm_confidence, partner_matched_exact=partner_matched_exact,
            partner_auto_created=partner_auto_created, account_source=account_source,
            duplicate_check="clear")
        will_post = score >= settings.auto_post_threshold
        note = narration.build_narration(score, account_source, will_post)

        line_items = [
            {"description": li.description, "quantity": li.quantity, "unit_price": li.unit_price, "amount": li.amount}
            for li in bill.line_items
        ]
        ok, msg, move_id, unmet = odoo_bills.create_vendor_bill(
            client, partner_id=partner_id, invoice_number=bill.invoice_number,
            invoice_date=bill.invoice_date, account_id=account_id, line_items=line_items, narration=note)
        if not ok:
            record_step(db, mission, idx, "create_bill", "gadget_call", "failed", error=msg,
                        output={"unmet_required_fields": unmet})
            _finish(db, mission, "succeeded" if unmet else "failed", {
                "vendor_name": bill.vendor_name, "invoice_number": bill.invoice_number,
                "total": bill.total, "currency": bill.currency, "posted": False,
                "needs_review": bool(unmet), "review_reason": msg,
            }, None if unmet else msg)
            return
        record_step(db, mission, idx, "create_bill", "gadget_call", "succeeded", output={
            "odoo_move_id": move_id, "confidence": score})
        idx += 1

        # --- Step 7: optional auto-post ---------------------------------------------------------
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
            "posted": posted, "duplicate": False, "needs_review": False,
        })
    except odoo.OdooError as exc:
        record_step(db, mission, idx, "odoo_error", "gadget_call", "failed", error=str(exc))
        _finish(db, mission, "failed", {"vendor_name": bill.vendor_name}, str(exc))


register_playbook(PLAYBOOK_KEY, run)
