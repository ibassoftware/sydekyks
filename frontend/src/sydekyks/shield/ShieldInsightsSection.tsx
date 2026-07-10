import { useEffect, useState } from "react";
import { api, type ShieldAlert, type ShieldInsights } from "../../lib/api";
import { formatWorkTime, formatFastTime } from "../../lib/format";
import { Card } from "../../components/ui";
import { AgentThumb } from "../../components/AgentThumb";

const money = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });

function riskPill(score: number): string {
  return score >= 70
    ? "border-red-700/50 bg-red-500/10 text-red-300"
    : score >= 40
      ? "border-amber-700/50 bg-amber-500/10 text-amber-300"
      : "border-ink-600 bg-ink-800/60 text-[#b9ad98]";
}

/** Shield dashboard card — the ranked auditor review queue is the product. Advisory framing only:
 * "warrants review", confirm / clear, never an accusation. */
export function ShieldInsightsSection() {
  const [data, setData] = useState<ShieldInsights | null>(null);
  const [decided, setDecided] = useState<Record<string, string>>({});

  useEffect(() => {
    api.get<ShieldInsights>("/tenant/shield/insights").then((r) => setData(r.data)).catch(() => setData(null));
  }, []);

  if (!data || !data.activated || data.total_assessed === 0) return null;

  async function decide(a: ShieldAlert, decision: "confirmed" | "cleared") {
    setDecided((d) => ({ ...d, [a.finding_id]: decision }));
    // On a false positive, suppress the strongest rule for this vendor so it stops firing.
    const rule_code = decision === "cleared" ? [...a.flags].sort((x, y) => y.weight - x.weight)[0]?.code : undefined;
    try {
      await api.post(`/tenant/shield/findings/${a.finding_id}/decision`, { decision, rule_code });
    } catch {
      setDecided((d) => {
        const next = { ...d };
        delete next[a.finding_id];
        return next;
      });
    }
  }

  const cur = data.review_queue[0]?.currency ?? "";

  return (
    <Card className="relative mt-6 overflow-hidden p-6">
      <div className="relative flex items-center gap-3">
        <AgentThumb slug="shield" alt="Shield" />
        <div>
          <p className="text-sm font-bold text-[#f5eee0]">Shield</p>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-gold-500">Fraud risk · Live</p>
        </div>
      </div>

      <div className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#8a7f6d]">Exposure under review</p>
        <p className="mt-1 text-4xl font-bold text-[#f5eee0]">{cur} {money(data.exposure_amount)}</p>
        <p className="mt-2 text-sm font-medium text-gold-300">
          {data.total_assessed.toLocaleString()} bills assessed in {formatFastTime(data.processing_seconds)}
          <span className="font-normal text-[#8a7f6d]">
            {" "}· ~{formatWorkTime(data.total_assessed * data.estimated_minutes_each)} by hand
          </span>
        </p>
      </div>

      <div className="mt-5 grid max-w-md grid-cols-3 gap-3">
        <Stat value={data.flagged_count.toLocaleString()} label="Warrant review" accent />
        <Stat value={data.holds_count.toLocaleString()} label="Hard-holds" />
        <Stat value={data.total_assessed.toLocaleString()} label="Bills assessed" />
      </div>

      {data.review_queue.length > 0 && (
        <div className="mt-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#8a7f6d]">Auditor review queue</p>
          <div className="mt-2 grid gap-2">
            {data.review_queue.map((a) => {
              const outcome = decided[a.finding_id] ?? a.human_decision;
              return (
                <div key={a.finding_id} className={`rounded-lg border px-3 py-2.5 ${a.hold ? "border-red-700/50 bg-red-500/[0.06]" : "border-ink-700"}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${riskPill(a.risk_score)}`}>
                      risk {a.risk_score}
                    </span>
                    {a.hold && <span className="rounded-full border border-red-700/50 bg-red-500/10 px-2 py-0.5 text-[11px] font-semibold text-red-300">HARD-HOLD</span>}
                    <span className="text-sm font-medium text-[#ede6da]">{a.vendor_name ?? "Vendor"}</span>
                    {a.ref && <span className="text-xs text-[#8a7f6d]">#{a.ref}</span>}
                    {a.amount != null && <span className="text-sm text-[#ede6da]">{a.currency} {a.amount.toFixed(2)}</span>}
                    {a.odoo_url && (
                      <a href={a.odoo_url} target="_blank" rel="noopener noreferrer" className="ml-auto shrink-0 text-xs font-semibold text-gold-400 hover:text-gold-300">
                        Open →
                      </a>
                    )}
                  </div>
                  {a.summary && <p className="mt-1 text-xs text-[#d8cdb9]">{a.summary}</p>}
                  {a.flags.length > 0 && (
                    <ul className="mt-1 grid gap-0.5">
                      {a.flags.map((f) => (
                        <li key={f.code} className="text-[11px] text-[#8a7f6d]">• {f.label}{f.evidence ? ` — ${f.evidence}` : ""}</li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {outcome ? (
                      <span className="text-xs font-semibold text-gold-400">Marked: {outcome === "confirmed" ? "confirmed risk" : "cleared (false positive)"}</span>
                    ) : (
                      <>
                        <DecisionBtn label="Confirm — escalate" tone="danger" onClick={() => decide(a, "confirmed")} />
                        <DecisionBtn label="Clear — false positive" tone="ghost" onClick={() => decide(a, "cleared")} />
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {data.top_rules.length > 0 && (
        <div className="mt-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#8a7f6d]">Signals firing most</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {data.top_rules.map((r) => (
              <span key={r.label} className="rounded-full border border-ink-600 bg-ink-800/60 px-2.5 py-1 text-xs text-[#d8cdb9]">
                {r.label} <span className="text-[#8a7f6d]">· {r.count}</span>
              </span>
            ))}
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
