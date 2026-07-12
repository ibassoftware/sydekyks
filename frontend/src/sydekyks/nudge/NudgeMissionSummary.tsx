import { Badge } from "../../components/ui";
import { formatMoney } from "../../lib/format";

/** Renders a Nudge follow-up Mission result. A Mission may end in a "skipped" (guarded) or "not
 * stale" state — those read as calm, non-action outcomes; an acted-on opp shows the drafted nudge. */
export function NudgeMissionSummary({ summary }: { summary: Record<string, unknown> }) {
  const opp = (summary.opp_name as string) ?? "Opportunity";
  const partner = summary.partner_name as string | null;
  const salesperson = summary.salesperson as string | null;
  const stage = summary.stage_name as string | null;
  const daysStale = summary.days_stale as number | undefined;
  const skipped = summary.skipped as string | undefined;
  const stale = summary.stale as boolean | undefined;
  const overdue = summary.overdue as boolean | undefined;
  const activityCreated = summary.activity_created as boolean | undefined;
  const draftSubject = summary.draft_subject as string | null;
  const revenue = summary.expected_revenue as number | undefined;
  const currency = (summary.currency as string) ?? "";

  const SKIP_LABEL: Record<string, string> = {
    snoozed: "Paused deal — skipped",
    cadence: "Recently nudged — skipped",
    future_activity: "Next touch already scheduled",
  };

  return (
    <div className="mt-2 grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-[#f5eee0]">{opp}</p>
        {partner && <span className="text-xs text-[#8a7f6d]">· {partner}</span>}
        {stage && <span className="rounded-full border border-ink-600 bg-ink-800/60 px-2 py-0.5 text-[11px] text-[#b9ad98]">{stage}</span>}
        {revenue !== undefined && revenue > 0 && (
          <span className="text-sm text-[#ede6da]">{formatMoney(revenue, currency)}</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {skipped ? (
          <Badge tone="neutral">{SKIP_LABEL[skipped] ?? "Skipped"}</Badge>
        ) : stale === false ? (
          <Badge tone="gold">Still fresh — no nudge needed</Badge>
        ) : overdue ? (
          <Badge tone="danger">Existing activity overdue — surfaced, not duplicated</Badge>
        ) : activityCreated ? (
          <Badge tone="gold">Follow-up drafted{salesperson ? ` for ${salesperson}` : ""}</Badge>
        ) : (
          <Badge tone="neutral">Drafted to chatter</Badge>
        )}
        {typeof daysStale === "number" && skipped === undefined && stale !== false && (
          <span className="text-xs text-[#8a7f6d]">silent {daysStale}d</span>
        )}
      </div>

      {draftSubject && !skipped && stale !== false && (
        <div className="rounded-lg border border-gold-700/30 bg-gold-500/[0.05] px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gold-400/90">Suggested follow-up</p>
          <p className="mt-1 text-sm text-[#d8cdb9]">{draftSubject}</p>
          <p className="mt-1 text-[11px] text-[#8a7f6d]">Draft only — the rep edits and sends from Odoo.</p>
        </div>
      )}
    </div>
  );
}
