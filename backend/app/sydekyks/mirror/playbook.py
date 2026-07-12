"""Mirror's duplicate-bill playbook — registered under 'mirror.duplicate_check'.

Runs over ONE existing Odoo vendor bill (id in `mission.trigger_context`). Compares it against the
vendor's other bills (and cross-vendor records sharing a VAT/bank) in confidence tiers, uses AI only
to confirm ambiguous same-amount/different-reference cases by their line items, suppresses known
recurring patterns, logs the check to the bill's chatter, and raises a Command-Center issue when the
confidence clears the tenant's threshold.
"""

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.core.crypto import decrypt_secret
from app.models.mission import Mission
from app.services import gadget_links, mission_ai, odoo, odoo_finance, review_assignment, tenant_issues, usage_guard
from app.services.missions import record_step, register_playbook

from app.sydekyks.mirror import detection, extraction
from app.sydekyks.mirror.models import MirrorFinding, MirrorRecurringPattern, MirrorTenantSettings

PLAYBOOK_KEY = "mirror.duplicate_check"

# Superhero-themed step copy (Mirror is the AP watchdog that unmasks impostor bills) — flavour in the
# titles, but every description/failure stays plain so it's clear what actually happens.
PLAYBOOK_STEPS = [
    {"key": "connect_odoo", "title": "Link up with Odoo",
     "description": "Open a secure line to your assigned Odoo instance.",
     "likely_failures": "No Odoo assigned, wrong credentials, or Odoo is unreachable."},
    {"key": "load_bill", "title": "Scan the target bill",
     "description": "Read the vendor bill, its line items, and the vendor's profile.",
     "likely_failures": "The bill was deleted or isn't a vendor bill."},
    {"key": "gather_candidates", "title": "Round up the suspects",
     "description": "Gather the vendor's other bills and any records sharing its Tax ID or bank account.",
     "likely_failures": "None fatal — Mirror just has fewer bills to compare against."},
    {"key": "detect", "title": "Unmask the duplicate",
     "description": "Match by reference, by amount + date, and across split vendor records — then let the AI confirm sneaky look-alikes by their line items.",
     "likely_failures": "None fatal — a clean bill simply scores zero and walks free."},
    {"key": "record", "title": "Sound the alarm",
     "description": "Log the verdict to the bill's chatter and flag high-confidence duplicates for review.",
     "likely_failures": "Best-effort writes to Odoo."},
]


def _finish(db, mission, status, summary, error=None, failure_category=None):
    mission.status = status
    mission.result_summary = summary
    mission.error_message = error
    mission.failure_category = failure_category if status == "failed" else None
    mission.completed_at = datetime.now(timezone.utc)
    db.commit()


def _settings(db, tenant_id) -> MirrorTenantSettings:
    s = db.query(MirrorTenantSettings).filter(MirrorTenantSettings.tenant_id == tenant_id).first()
    if s is None:
        s = MirrorTenantSettings(tenant_id=tenant_id)
        db.add(s)
        db.commit()
        db.refresh(s)
    return s


def _is_suppressed(db, tenant_id, sydekyk_id, partner_id, amount) -> bool:
    """A clerk marked this vendor (optionally at this amount) as legitimately recurring."""
    q = db.query(MirrorRecurringPattern).filter(
        MirrorRecurringPattern.tenant_id == tenant_id,
        MirrorRecurringPattern.sydekyk_id == sydekyk_id,
        MirrorRecurringPattern.partner_id == partner_id,
    )
    for p in q.all():
        if p.amount is None or (amount is not None and round(p.amount, 2) == round(amount, 2)):
            return True
    return False


def _vendor(bill: dict) -> tuple[int | None, str | None]:
    pf = bill.get("partner_id")
    if isinstance(pf, list) and pf:
        return pf[0], (pf[1] if len(pf) > 1 else None)
    return None, None


def _build_note(bill, tier, confidence, reasons, matched_ids, suppressed) -> str:
    rows = ["<p><b>Mirror checked this bill for duplicates.</b></p>"]
    if not matched_ids:
        rows.append("<p>No duplicates found — this bill looks unique.</p>")
    else:
        verdict = "Suppressed (marked recurring)" if suppressed else f"Possible duplicate — {confidence}% confidence"
        rows.append(f"<p><b>{verdict}</b> (matched {len(matched_ids)} bill(s), tier: {tier}).</p>")
        if reasons:
            rows.append("<p>" + "; ".join(reasons) + "</p>")
    return "".join(rows)


def run(db: Session, mission: Mission) -> None:
    idx = 0
    ctx = mission.trigger_context or {}
    move_id = ctx.get("odoo_move_id")
    settings = _settings(db, mission.tenant_id)

    if not move_id:
        record_step(db, mission, idx, "load_bill", "internal", "failed", error="No target bill supplied")
        _finish(db, mission, "failed", {}, "No target bill supplied", failure_category="validation")
        return

    link = gadget_links.find_assigned_link(db, tenant_id=mission.tenant_id, sydekyk_id=mission.sydekyk_id, role_key="erp")
    if link is None:
        record_step(db, mission, idx, "connect_odoo", "gadget_call", "failed", error="No Odoo instance assigned to Mirror.")
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
        # --- Load the bill + vendor -------------------------------------------------------------
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
                    output={"vendor": vendor_name, "amount": amount, "ref": bill.get("ref")})
        idx += 1

        # --- Gather comparison set --------------------------------------------------------------
        states = ["draft", "posted"] if settings.include_drafts else ["posted"]
        others = odoo_finance.search_vendor_bills(client, partner_id=partner_id, exclude_id=int(move_id), states=states) if partner_id else []
        same_vat_ids: set[int] = set()
        same_bank_ids: set[int] = set()
        others_by_partner: dict[int, list[dict]] = {}
        if partner:
            svp = partner.get("same_vat_partner_id")
            if isinstance(svp, list) and svp:
                same_vat_ids.add(svp[0])
            # partners sharing any of this vendor's bank accounts
            for bank in odoo_finance.bank_accounts(client, partner_id):
                san = bank.get("sanitized_acc_number")
                if not san:
                    continue
                shared = client.search_read("res.partner.bank", [["sanitized_acc_number", "=", san]], ["partner_id"])
                for row in shared:
                    pid = row.get("partner_id")[0] if isinstance(row.get("partner_id"), list) else None
                    if pid and pid != partner_id:
                        same_bank_ids.add(pid)
            for pid in same_vat_ids | same_bank_ids:
                others_by_partner[pid] = odoo_finance.search_vendor_bills(client, partner_id=pid, states=states)
        record_step(db, mission, idx, "gather_candidates", "gadget_call", "succeeded",
                    output={"same_vendor_bills": len(others), "related_partners": len(others_by_partner)})
        idx += 1

        # --- Detect: deterministic tiers surface grounded CANDIDATES; AI renders the verdict --------
        tier, confidence, reasons, matched = "none", 0, [], []
        ex_ids, ex_reasons, ex_conf = detection.exact_match(bill, others)
        fz_ids, fz_reasons, fz_conf = detection.fuzzy_match(bill, others, window_days=settings.date_window_days)
        cv_ids, cv_reasons, cv_conf = detection.cross_vendor_match(
            bill, partner, others_by_partner,
            same_vat_partner_ids=same_vat_ids, same_bank_partner_ids=same_bank_ids,
            window_days=settings.date_window_days,
        )
        if ex_ids:
            tier, confidence, reasons, matched = "exact", ex_conf, list(ex_reasons), list(ex_ids)
        if fz_ids and fz_conf > confidence:
            tier, confidence = "fuzzy", fz_conf
        if fz_ids:
            reasons += fz_reasons
            matched = list(dict.fromkeys(matched + fz_ids))
        if cv_ids:
            reasons += cv_reasons
            matched = list(dict.fromkeys(matched + cv_ids))
            if cv_conf > confidence:
                tier, confidence = "cross_vendor", cv_conf

        # AI adjudication is the primary verdict — it judges the candidates the deterministic layer
        # found (it can't invent a match), weighing vendor/ref/amount/date/line-items holistically.
        # An exact-reference hit is already near-certain, so we skip the (billable) call there.
        if matched and tier != "exact":
            llm, virtual_key, model_alias = mission_ai.get_llm(db, mission)
            allowed = True
            if llm is not None:
                allowed, _deny = usage_guard.check_allowed(db, mission.tenant_id, mission.sydekyk_id, model_alias)
            if llm is not None and allowed:
                candidate = {"vendor_name": vendor_name, "ref": bill.get("ref"), "amount": amount,
                             "currency": currency, "invoice_date": bill.get("invoice_date"),
                             "lines": odoo_finance.bill_lines(client, int(move_id))}
                match_ctx = []
                by_id = {o["id"]: o for o in others + [x for lst in others_by_partner.values() for x in lst]}
                for mid in matched[:4]:
                    o = by_id.get(mid, {})
                    ov = o.get("partner_id")[1] if isinstance(o.get("partner_id"), list) else None
                    oc = o.get("currency_id")[1] if isinstance(o.get("currency_id"), list) else None
                    match_ctx.append({"vendor_name": ov, "ref": o.get("ref"),
                                      "amount": round(float(o.get("amount_total") or 0.0), 2), "currency": oc,
                                      "invoice_date": o.get("invoice_date"), "lines": odoo_finance.bill_lines(client, mid)})
                ok_ai, _m, verdict, meta = extraction.adjudicate_duplicate(virtual_key, model_alias, candidate, match_ctx)
                mission_ai.emit_usage(db, mission, llm, meta)
                if ok_ai and verdict:
                    confidence = verdict["confidence"]
                    tier = "ai_judgment"
                    if verdict["reasoning"]:
                        reasons.append("AI: " + verdict["reasoning"])

        suppressed = bool(matched) and _is_suppressed(db, mission.tenant_id, mission.sydekyk_id, partner_id, amount)
        is_duplicate = bool(matched) and confidence >= settings.flag_threshold and not suppressed
        record_step(db, mission, idx, "detect", "internal", "succeeded",
                    output={"tier": tier, "confidence": confidence, "matched": len(matched), "suppressed": suppressed})
        idx += 1

        # --- Record: chatter note, finding row, Command-Center issue -----------------------------
        odoo_finance.post_bill_note(client, int(move_id), _build_note(bill, tier, confidence, reasons, matched, suppressed))
        db.add(MirrorFinding(
            tenant_id=mission.tenant_id, sydekyk_id=mission.sydekyk_id, mission_id=mission.id,
            odoo_move_id=int(move_id), vendor_name=vendor_name, partner_id=partner_id,
            ref=bill.get("ref") or None, amount=amount, currency=currency,
            is_duplicate=is_duplicate, confidence=confidence, tier=tier,
            reasons=reasons or None, matched_move_ids=matched or None, suppressed=suppressed,
        ))
        if is_duplicate:
            tenant_issues.report_issue(
                db, tenant_id=mission.tenant_id, sydekyk_id=mission.sydekyk_id, kind="mirror_duplicate",
                title=f"Possible duplicate bill — {vendor_name or 'vendor'} {bill.get('ref') or ''}".strip(),
                detail=f"{confidence}% confidence ({tier}). " + "; ".join(reasons), mission_id=mission.id,
            )
            review_assignment.assign_on_flag(
                db, client, tenant_id=mission.tenant_id, sydekyk_id=mission.sydekyk_id,
                model="account.move", res_id=int(move_id),
                summary=f"Possible duplicate ({confidence}%) — {vendor_name or 'vendor'} {bill.get('ref') or ''}".strip(),
                note="<p>Why: " + "; ".join(reasons) + ".</p>" if reasons else None,
                steps=[
                    "Open this bill and the matched bill(s) side by side to compare vendor, reference, amount and lines.",
                    "If it's the same purchase billed twice, cancel or delete the duplicate before it gets paid.",
                    "If it's legitimately recurring (rent, a subscription, a retainer), mark the vendor 'Recurring' in Mirror so it stops flagging.",
                    "If it's not a duplicate at all, dismiss it on Mirror's dashboard.",
                ],
            )
        record_step(db, mission, idx, "record", "gadget_call", "succeeded", output={"flagged": is_duplicate})
        idx += 1

        _finish(db, mission, "succeeded", {
            "odoo_move_id": int(move_id), "vendor_name": vendor_name, "ref": bill.get("ref"),
            "amount": amount, "currency": currency, "is_duplicate": is_duplicate, "confidence": confidence,
            "tier": tier, "matched_count": len(matched), "suppressed": suppressed,
            "needs_review": is_duplicate,
        })
    except odoo.OdooError as exc:
        record_step(db, mission, idx, "odoo_error", "gadget_call", "failed", error=str(exc))
        _finish(db, mission, "failed", {"vendor_name": None}, str(exc), failure_category="external")


register_playbook(PLAYBOOK_KEY, run)
