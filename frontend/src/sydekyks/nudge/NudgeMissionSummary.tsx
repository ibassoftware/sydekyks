import { useState } from "react";
import { api } from "../../lib/api";
import { Badge } from "../../components/ui";
import { formatMoney } from "../../lib/format";

/** Renders a Nudge Mission result. Three shapes: a pipeline "sweep" (the run receipt), a follow-up
 * on one opp (drafted / skipped / still-fresh), and — on any opp-scoped result — a quick "pause this
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

      {leadId !== undefined && skipped !== "snoozed" && <PauseDeal leadId={leadId} oppName={opp} />}
    </div>
  );
}

function SweepSummary({ summary }: { summary: Record<string, unknown> }) {
  const open = (summary.open_total as number) ?? 0;
  const stale = (summary.stale_enqueued as number) ?? 0;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Badge tone={stale > 0 ? "gold" : "neutral"}>Pipeline checked</Badge>
      <span className="text-sm text-[#ede6da]">{open} open opportunit{open === 1 ? "y" : "ies"}</span>
      <span className="text-xs text-[#8a7f6d]">
        · {stale > 0 ? `${stale} stale — drafting follow-ups` : "all tended, nothing stale"}
      </span>
    </div>
  );
}

/** Quick "leave this deal alone" — whitelists the opp via the snooze endpoint (no date = never). */
function PauseDeal({ leadId, oppName }: { leadId: number; oppName: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  async function pause() {
    setState("busy");
    try {
      await api.post("/tenant/nudge/snoozes", { odoo_lead_id: leadId, snooze_until: null, note: `Paused from mission: ${oppName}` });
      setState("done");
    } catch {
      setState("idle");
    }
  }
  if (state === "done") return <p className="text-[11px] font-semibold text-gold-400">Paused — Nudge will leave this deal alone.</p>;
  return (
    <button
      onClick={pause}
      disabled={state === "busy"}
      className="w-fit rounded-md border border-ink-600 bg-ink-800/60 px-2.5 py-1 text-[11px] font-semibold text-[#b9ad98] hover:bg-ink-700 disabled:opacity-50"
    >
      {state === "busy" ? "Pausing…" : "Pause this deal"}
    </button>
  );
}
