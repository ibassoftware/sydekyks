import { useEffect, useState } from "react";
import { api, type MirrorFlag, type MirrorInsights } from "../../lib/api";
import { formatWorkTime, formatFastTime } from "../../lib/format";
import { Card } from "../../components/ui";
import { AgentThumb } from "../../components/AgentThumb";

const money = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });

/** Mirror dashboard card — double-payments prevented ($) up top, then the review queue of recent
 * flags with confirm / dismiss / mark-recurring actions (the learning loop). */
export function MirrorInsightsSection() {
  const [data, setData] = useState<MirrorInsights | null>(null);
  const [decided, setDecided] = useState<Record<string, string>>({});

  useEffect(() => {
    api.get<MirrorInsights>("/tenant/mirror/insights").then((r) => setData(r.data)).catch(() => setData(null));
  }, []);

  if (!data || !data.activated || data.total_checked === 0) return null;

  async function decide(f: MirrorFlag, decision: "confirmed_duplicate" | "not_duplicate" | "recurring") {
    setDecided((d) => ({ ...d, [f.finding_id]: decision }));
    try {
      await api.post(`/tenant/mirror/findings/${f.finding_id}/decision`, { decision });
    } catch {
      setDecided((d) => {
        const next = { ...d };
        delete next[f.finding_id];
        return next;
      });
    }
  }

  const cur = data.recent_flags[0]?.currency ?? "";

  return (
    <Card className="relative mt-6 overflow-hidden p-6">
      <div className="relative flex items-center gap-3">
        <AgentThumb slug="mirror" alt="Mirror" />
        <div>
          <p className="text-sm font-bold text-[#f5eee0]">Mirror</p>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-gold-500">Duplicate bills · Live</p>
        </div>
      </div>

      <div className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#8a7f6d]">Double-payments prevented</p>
        <p className="mt-1 text-4xl font-bold text-[#f5eee0]">{cur} {money(data.prevented_amount)}</p>
        <p className="mt-2 text-sm font-medium text-gold-300">
          {data.total_checked.toLocaleString()} bills checked in {formatFastTime(data.processing_seconds)}
          <span className="font-normal text-[#8a7f6d]">
            {" "}· ~{formatWorkTime(data.total_checked * data.estimated_minutes_each)} by hand
          </span>
        </p>
      </div>

      <div className="mt-5 grid max-w-md grid-cols-3 gap-3">
        <Stat value={data.duplicates_found.toLocaleString()} label="Duplicates caught" accent />
        <Stat value={data.total_checked.toLocaleString()} label="Bills checked" />
        <Stat value={data.suppressed_count.toLocaleString()} label="Recurring (suppressed)" />
      </div>

      {data.recent_flags.length > 0 && (
        <div className="mt-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#8a7f6d]">Review queue</p>
          <div className="mt-2 grid gap-2">
            {data.recent_flags.map((f) => {
              const outcome = decided[f.finding_id] ?? f.human_decision;
              return (
                <div key={f.finding_id} className="rounded-lg border border-ink-700 px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-red-700/50 bg-red-500/10 px-2 py-0.5 text-[11px] font-semibold text-red-300">
                      {f.confidence}%
                    </span>
                    <span className="text-sm font-medium text-[#ede6da]">{f.vendor_name ?? "Vendor"}</span>
                    {f.ref && <span className="text-xs text-[#8a7f6d]">#{f.ref}</span>}
                    {f.amount != null && <span className="text-sm text-[#ede6da]">{f.currency} {f.amount.toFixed(2)}</span>}
                    {f.tier && <span className="text-[11px] text-[#8a7f6d]">· {f.tier}</span>}
                    {f.odoo_url && (
                      <a href={f.odoo_url} target="_blank" rel="noopener noreferrer" className="ml-auto shrink-0 text-xs font-semibold text-gold-400 hover:text-gold-300">
                        Open →
                      </a>
                    )}
                  </div>
                  {f.reasons.length > 0 && <p className="mt-1 text-xs text-[#8a7f6d]">{f.reasons.join("; ")}</p>}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {outcome ? (
                      <span className="text-xs font-semibold text-gold-400">
                        Marked: {outcome.replace(/_/g, " ")}
                      </span>
                    ) : (
                      <>
                        <DecisionBtn label="Confirm duplicate" tone="danger" onClick={() => decide(f, "confirmed_duplicate")} />
                        <DecisionBtn label="Not a duplicate" tone="ghost" onClick={() => decide(f, "not_duplicate")} />
                        <DecisionBtn label="Recurring — stop flagging" tone="ghost" onClick={() => decide(f, "recurring")} />
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}

function Stat({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <div>
      <p className={`text-2xl font-bold ${accent ? "text-gold-300" : "text-[#f5eee0]"}`}>{value}</p>
      <p className="text-[11px] text-[#8a7f6d]">{label}</p>
    </div>
  );
}

function DecisionBtn({ label, tone, onClick }: { label: string; tone: "danger" | "ghost"; onClick: () => void }) {
  const cls =
    tone === "danger"
      ? "border-red-700/50 bg-red-500/10 text-red-300 hover:bg-red-500/20"
      : "border-ink-600 bg-ink-800/60 text-[#b9ad98] hover:bg-ink-700";
  return (
    <button onClick={onClick} className={`rounded-md border px-2.5 py-1 text-xs font-semibold ${cls}`}>
      {label}
    </button>
  );
}
