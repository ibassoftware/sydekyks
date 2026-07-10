"""Shield's fraud-risk playbook — registered under 'shield.risk_assess'.

Risk-assesses ONE existing Odoo vendor bill (id in `mission.trigger_context`) against a set of
deterministic rules (bank-change-before-payment, employee↔vendor collision, segregation-of-duties,
phantom vendor, amount-above-norm, round number, off-hours), scores it, and — when the score clears
the threshold — raises an auditor review-queue issue with the evidence. An AI step writes the
advisory 'warrants review' narrative. Shield never accuses and defers duplicate detection to Mirror.
"""

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.core.crypto import decrypt_secret
from app.models.mission import Mission
from app.services import gadget_links, mission_ai, odoo, odoo_finance, tenant_issues, usage_guard
from app.services.missions import record_step, register_playbook

from app.sydekyks.shield import detection, extraction
from app.sydekyks.shield.models import ShieldFinding, ShieldSuppression, ShieldTenantSettings

PLAYBOOK_KEY = "shield.risk_assess"

PLAYBOOK_STEPS = [
    {"key": "connect_odoo", "title": "Connect to Odoo",
     "description": "Open an authenticated session to the assigned Odoo instance.",
     "likely_failures": "No Odoo assigned, wrong credentials, or Odoo unreachable."},
    {"key": "load_bill", "title": "Load the bill",
     "description": "Read the vendor bill and the vendor's profile.",
     "likely_failures": "The bill was deleted or isn't a vendor bill."},
    {"key": "gather_context", "title": "Gather signals",
     "description": "Collect bank history, employee cross-references, payment and vendor history.",
     "likely_failures": "None fatal — missing modules just skip a check."},
    {"key": "assess", "title": "Assess risk",
     "description": "Run the fraud-risk rules, score them, and write an advisory review briefing.",
     "likely_failures": "None fatal — a clean bill scores 0."},
    {"key": "record", "title": "Log the assessment",
     "description": "Post the result to the bill's chatter and queue high-risk bills for the auditor.",
     "likely_failures": "Best-effort writes to Odoo."},
]


def _finish(db, mission, status, summary, error=None, failure_category=None):
    mission.status = status
    mission.result_summary = summary
    mission.error_message = error
    mission.failure_category = failure_category if status == "failed" else None
    mission.completed_at = datetime.now(timezone.utc)
    db.commit()


def _settings(db, tenant_id) -> ShieldTenantSettings:
    s = db.query(ShieldTenantSettings).filter(ShieldTenantSettings.tenant_id == tenant_id).first()
    if s is None:
        s = ShieldTenantSettings(tenant_id=tenant_id)
        db.add(s)
        db.commit()
        db.refresh(s)
    return s


def _uid(v) -> int | None:
    return v[0] if isinstance(v, list) and v else None


def _vendor(bill: dict) -> tuple[int | None, str | None]:
    pf = bill.get("partner_id")
    if isinstance(pf, list) and pf:
        return pf[0], (pf[1] if len(pf) > 1 else None)
    return None, None


def _build_note(risk_score, hold, flags, summary) -> str:
    rows = ["<p><b>Shield risk-assessed this bill.</b></p>"]
    if not flags:
        rows.append("<p>No risk signals — this bill looks normal.</p>")
    else:
        head = "HARD-HOLD — " if hold else ""
        rows.append(f"<p><b>{head}Risk {risk_score}/100.</b> This warrants a review (advisory only).</p>")
        if summary:
            rows.append(f"<p>{summary}</p>")
        rows.append("<ul>" + "".join(f"<li>{f['label']}: {f.get('evidence','')}</li>" for f in flags) + "</ul>")
    return "".join(rows)


def run(db: Session, mission: Mission) -> None:
    idx = 0
    ctx = mission.trigger_context or {}
    move_id = ctx.get("odoo_move_id")
    settings = _settings(db, mission.tenant_id)
    now = datetime.now(timezone.utc).replace(tzinfo=None)  # Odoo stores naive-UTC datetimes

    if not move_id:
        record_step(db, mission, idx, "load_bill", "internal", "failed", error="No target bill supplied")
        _finish(db, mission, "failed", {}, "No target bill supplied", failure_category="validation")
        return

    link = gadget_links.find_assigned_link(db, tenant_id=mission.tenant_id, sydekyk_id=mission.sydekyk_id, role_key="erp")
    if link is None:
        record_step(db, mission, idx, "connect_odoo", "gadget_call", "failed", error="No Odoo instance assigned to Shield.")
        _finish(db, mission, "failed", {}, "No Odoo instance assigned", failure_category="setup")
        return
    ok, msg, client = odoo.connect(link.url, link.database, link.username, decrypt_secret(link.encrypted_secret))
    if not ok or client is None:
        record_step(db, mission, idx, "connect_odoo", "gadget_call", "failed", error=msg)
        _finish(db, mission, "failed", {}, msg, failure_category="external")
        return
    record_step(db, mission, idx, "connect_odoo", "gadget_call", "succeeded", output={"instance": link.name})
    idx += 1

    try:
        bill = odoo_finance.read_bill(client, int(move_id))
        if bill is None or bill.get("move_type") != "in_invoice":
            record_step(db, mission, idx, "load_bill", "gadget_call", "failed", error="Not a vendor bill")
            _finish(db, mission, "failed", {}, "Not a vendor bill", failure_category="validation")
            return
        partner_id, vendor_name = _vendor(bill)
        partner = odoo_finance.partner_info(client, partner_id) if partner_id else None
        amount = round(float(bill.get("amount_total") or 0.0), 2)
        currency = bill.get("currency_id")[1] if isinstance(bill.get("currency_id"), list) else None
        record_step(db, mission, idx, "load_bill", "gadget_call", "succeeded",
                    output={"vendor": vendor_name, "amount": amount})
        idx += 1

        # --- Gather signals ---------------------------------------------------------------------
        vendor_banks = odoo_finance.bank_accounts(client, partner_id) if partner_id else []
        vendor_other_bills = odoo_finance.search_vendor_bills(client, partner_id=partner_id, exclude_id=int(move_id)) if partner_id else []
        emp_banks = odoo_finance.employee_bank_numbers(client)
        emp_ids = odoo_finance.employee_identifications(client)
        payment_creator = odoo_finance.bill_payment_creator_uid(client, bill)
        suppressed = {
            r.rule_code for r in db.query(ShieldSuppression.rule_code).filter(
                ShieldSuppression.tenant_id == mission.tenant_id,
                ShieldSuppression.sydekyk_id == mission.sydekyk_id,
                ShieldSuppression.partner_id == partner_id,
            )
        } if partner_id else set()
        record_step(db, mission, idx, "gather_context", "gadget_call", "succeeded",
                    output={"vendor_banks": len(vendor_banks), "history": len(vendor_other_bills),
                            "suppressed_rules": len(suppressed)})
        idx += 1

        # --- Assess: run the rules, score, narrate ----------------------------------------------
        candidates = [
            detection.rule_bank_change_before_payment(bill, vendor_banks, recent_days=settings.recent_change_days, now=now),
            detection.rule_employee_vendor_collision(partner, vendor_banks, employee_bank_numbers=emp_banks, employee_ids=emp_ids),
            detection.rule_segregation_of_duties(
                bill_creator=_uid(bill.get("create_uid")),
                vendor_creator=_uid((partner or {}).get("create_uid")),
                payment_creator=payment_creator,
            ),
            detection.rule_phantom_vendor(bill, partner, recent_days=settings.recent_change_days,
                                          high_amount=settings.high_amount_threshold, now=now),
            detection.rule_amount_above_norm(bill, vendor_other_bills),
            detection.rule_round_number(bill),
            detection.rule_off_hours_entry(bill),
        ]
        flags = [f for f in candidates if f and f["code"] not in suppressed]
        # Deterministic base (grounded); a bank-change fires a hard-hold regardless of the model.
        risk_score, hold = detection.score(flags)

        summary = "; ".join(f["label"] for f in flags) or None
        if flags:
            # AI reasons holistically over the grounded signals + context — the primary risk verdict.
            llm, virtual_key, model_alias = mission_ai.get_llm(db, mission)
            if llm is not None:
                allowed, _deny = usage_guard.check_allowed(db, mission.tenant_id, mission.sydekyk_id, model_alias)
                if allowed:
                    bill_ctx = f"vendor={vendor_name!r} amount={amount} {currency or ''} ref={bill.get('ref')!r} payment_state={bill.get('payment_state')}"
                    vendor_ctx = (
                        f"created={(partner or {}).get('create_date')} prior_bills={(partner or {}).get('supplier_invoice_count')} "
                        f"tax_id={(partner or {}).get('vat')}" if partner else "(unknown vendor)"
                    )
                    ok_ai, _m, assessment, meta = extraction.assess_risk(
                        virtual_key, model_alias, bill=bill_ctx, vendor=vendor_ctx, flags=flags)
                    mission_ai.emit_usage(db, mission, llm, meta)
                    if ok_ai and assessment:
                        # AI score is primary; a hard-hold keeps a high floor so it can't be under-rated.
                        risk_score = max(assessment["risk_score"], 60) if hold else assessment["risk_score"]
                        summary = assessment["summary"] or summary
                        for concern in assessment["extra_concerns"]:
                            flags.append({"code": "ai_concern", "weight": 0, "label": "AI: worth checking", "evidence": concern})
        flagged = bool(flags) and (risk_score >= settings.flag_threshold or hold)
        record_step(db, mission, idx, "assess", "internal", "succeeded",
                    output={"risk_score": risk_score, "hold": hold, "flags": [f["code"] for f in flags]})
        idx += 1

        # --- Record -----------------------------------------------------------------------------
        odoo_finance.post_bill_note(client, int(move_id), _build_note(risk_score, hold, flags, summary))
        db.add(ShieldFinding(
            tenant_id=mission.tenant_id, sydekyk_id=mission.sydekyk_id, mission_id=mission.id,
            odoo_move_id=int(move_id), vendor_name=vendor_name, partner_id=partner_id,
            ref=bill.get("ref") or None, amount=amount, currency=currency,
            risk_score=risk_score, hold=hold, flags=flags or None, summary=summary,
        ))
        if flagged:
            title = ("HARD-HOLD: " if hold else "") + f"Review this bill — {vendor_name or 'vendor'} (risk {risk_score})"
            tenant_issues.report_issue(
                db, tenant_id=mission.tenant_id, sydekyk_id=mission.sydekyk_id, kind="shield_risk",
                title=title, detail=(summary or "") + " — advisory; auditor review recommended.", mission_id=mission.id,
            )
        record_step(db, mission, idx, "record", "gadget_call", "succeeded", output={"flagged": flagged})
        idx += 1

        _finish(db, mission, "succeeded", {
            "odoo_move_id": int(move_id), "vendor_name": vendor_name, "ref": bill.get("ref"),
            "amount": amount, "currency": currency, "risk_score": risk_score, "hold": hold,
            "flag_count": len(flags), "needs_review": flagged,
        })
    except odoo.OdooError as exc:
        record_step(db, mission, idx, "odoo_error", "gadget_call", "failed", error=str(exc))
        _finish(db, mission, "failed", {"vendor_name": None}, str(exc), failure_category="external")


register_playbook(PLAYBOOK_KEY, run)
