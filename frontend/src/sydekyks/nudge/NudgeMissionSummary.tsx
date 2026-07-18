import { Badge } from "../../components/ui";
import { formatMoney } from "../../lib/format";

/** Renders a Nudge Mission result. Three shapes: a pipeline "sweep" (the run receipt), a follow-up
 * on one opp (drafted / skipped / still-fresh), and - on any opp-scoped result - a quick "pause this
 * deal" action so a rep can whitelist a legitimately-quiet deal without leaving the mission. */
export function NudgeMissionSummary({ summary }: { summary: Record<string, unknown> }) {
  if (summary.mode === "nudge_sweep") return <SweepSummary summary={summary} />;

  const opp = (summary.opp_name as string) ?? "Opportunity";
  const leadId = summary.odoo_lead_id as number | undefined;
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
    snoozed: "Paused deal - skipped",
    odoo_tag: "Skipped by Odoo tag",
    cadence: "Recently nudged - skipped",
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
          <Badge tone="gold">Still fresh - no nudge needed</Badge>
        ) : overdue ? (
          <Badge tone="danger">Existing activity overdue - surfaced, not duplicated</Badge>
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
          <p className="mt-1 text-[11px] text-[#8a7f6d]">Draft only - the rep edits and sends from Odoo.</p>
        </div>
      )}

      {leadId !== undefined && !skipped && (
        <p className="text-[11px] text-body">To exclude this opportunity from future checks, add your configured Nudge skip tag in Odoo.</p>
      )}
    </div>
  );
}

function SweepSummary({ summary }: { summary: Record<string, unknown> }) {
  const open = (summary.open_total as number) ?? 0;
  const scheduled = (summary.scheduled as number) ?? 0;
  const snoozed = (summary.snoozed as number) ?? 0;
  const tagged = (summary.tagged_skip as number) ?? 0;
  const recent = (summary.recently_nudged as number) ?? 0;
  const queued = (summary.enqueued as number) ?? (summary.stale_enqueued as number) ?? 0;

  // Every open opportunity is accounted for: handled elsewhere, paused, recently nudged, or queued
  // for a closer look this run (the per-opp missions show each queued one's outcome).
  const rows: { label: string; n: number; hint: string }[] = [
    { label: "Have an upcoming activity", n: scheduled, hint: "a next touch is already planned - left alone" },
    { label: "Recently nudged", n: recent, hint: "inside the cadence window - not nagged again" },
    { label: "Paused / whitelisted", n: snoozed, hint: "you told Nudge to leave these alone" },
    { label: "Skipped by Odoo tag", n: tagged, hint: "excluded by your Nudge skip rule" },
    { label: "Queued for a closer look", n: queued, hint: "checked below - some may turn out still fresh" },
  ].filter((r) => r.n > 0);

  return (
    <div className="mt-2 grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={queued > 0 ? "gold" : "neutral"}>Pipeline checked</Badge>
        <span className="text-sm font-semibold text-[#ede6da]">{open} open opportunit{open === 1 ? "y" : "ies"}</span>
        {queued === 0 && <span className="text-xs text-[#8a7f6d]">· all tended, nothing to chase</span>}
      </div>
      {rows.length > 0 && (
        <ul className="grid gap-1">
          {rows.map((r) => (
            <li key={r.label} className="flex items-baseline gap-2 text-xs">
              <span className="w-6 shrink-0 text-right font-semibold text-[#ede6da]">{r.n}</span>
              <span className="text-[#b9ad98]">{r.label}</span>
              <span className="text-[#8a7f6d]"> -  {r.hint}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
