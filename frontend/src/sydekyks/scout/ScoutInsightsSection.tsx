import { useEffect, useState } from "react";
import { api, type RoleHealth, type ScoutInsights } from "../../lib/api";
import { formatWorkTime, formatFastTime } from "../../lib/format";
import { Card } from "../../components/ui";
import { AgentCardHeader } from "../../components/AgentCardHeader";

const money = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });

function scoreTone(score: number): string {
  return score >= 85 ? "bg-gold-400" : score >= 70 ? "bg-amber-500" : "bg-red-500";
}

/** Recruitment (scoring) dashboard card — a triage cockpit: pipeline health by role with an
 * expandable shortlist, the common gaps/strengths themes, and the score distribution. */
export function ScoutInsightsSection() {
  const [data, setData] = useState<ScoutInsights | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    api.get<ScoutInsights>("/tenant/scout/insights").then((r) => setData(r.data)).catch(() => setData(null));
  }, []);

  if (!data || !data.activated || data.total_scored === 0) return null;

  const maxBand = Math.max(1, ...data.distribution.map((b) => b.count));
  const toggle = (job: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      next.has(job) ? next.delete(job) : next.add(job);
      return next;
    });

  return (
    <Card className="relative mt-6 overflow-hidden p-6">
      <AgentCardHeader slug="scout" name="Scout" kicker="Candidates scored · Live" />

      <div className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#8a7f6d]">Estimated $ saved</p>
        <p className="mt-1 text-4xl font-bold text-[#f5eee0]">${money(data.estimated_net_savings)}</p>
        <p className="mt-1 text-xs text-[#8a7f6d]">
          ${money(data.estimated_manual_cost)} manual screening avoided − ${money(data.ai_cost)} AI cost
        </p>
        <p className="mt-2 text-sm font-medium text-gold-300">
          {data.total_scored.toLocaleString()} candidates scored in {formatFastTime(data.processing_seconds)}
          <span className="font-normal text-[#8a7f6d]">
            {" "}· ~{formatWorkTime(data.total_scored * data.estimated_minutes_each)} by hand
          </span>
        </p>
      </div>

      <div className="mt-5 grid max-w-md grid-cols-3 gap-3">
        <Stat value={data.total_scored.toLocaleString()} label="Scored" />
        <Stat value={data.strong_count.toLocaleString()} label="Strong (≥80)" accent />
        <Stat value={String(data.average_score)} label="Avg score" />
      </div>

      {/* Pipeline health by role — the manager's worklist. Expand a role for its shortlist. */}
      <div className="mt-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#8a7f6d]">Pipeline by role</p>
        <div className="mt-2 divide-y divide-ink-700/60 overflow-hidden rounded-lg border border-ink-700">
          {data.role_health.map((role) => (
            <RoleRow key={role.job_name} role={role} open={open.has(role.job_name)} onToggle={() => toggle(role.job_name)} />
          ))}
        </div>
      </div>

      {/* What the pool is missing vs. bringing — the AI-only insight that drives sourcing/JD tweaks. */}
      {(data.common_weaknesses.length > 0 || data.common_strengths.length > 0) && (
        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <ThemeList title="Most common gaps" items={data.common_weaknesses} tone="gap" />
          <ThemeList title="Most common strengths" items={data.common_strengths} tone="strength" />
        </div>
      )}

      <div className="mt-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#8a7f6d]">Score distribution</p>
        <div className="mt-2 grid gap-1.5">
          {data.distribution.map((b) => (
            <div key={b.band} className="flex items-center gap-2">
              <span className="w-14 text-[11px] text-[#8a7f6d]">{b.band}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-700">
                <div className="h-full rounded-full bg-gradient-to-r from-gold-600 to-gold-400" style={{ width: `${(b.count / maxBand) * 100}%` }} />
              </div>
              <span className="w-6 text-right text-[11px] text-[#b9ad98]">{b.count}</span>
            </div>
          ))}
        </div>
      </div>
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

function RoleRow({ role, open, onToggle }: { role: RoleHealth; open: boolean; onToggle: () => void }) {
  return (
    <div>
      <button onClick={onToggle} className="grid w-full grid-cols-[1fr_auto] items-center gap-3 px-3 py-2.5 text-left hover:bg-ink-800/40">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-[#ede6da]">{role.job_name}</p>
          <p className="text-[11px] text-[#8a7f6d]">
            {role.scored} scored · avg {role.avg_score} · top {role.top_score}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-gold-600/40 bg-gold-500/10 px-2 py-0.5 text-[11px] font-semibold text-gold-300">
            {role.strong} strong
          </span>
          <span className="text-[#8a7f6d]">{open ? "▾" : "▸"}</span>
        </div>
      </button>
      {open && (
        <div className="grid gap-1.5 border-t border-ink-700/60 bg-ink-950/40 px-3 py-2.5">
          {role.top_candidates.map((c, i) => (
            <div key={i} className="flex items-center gap-2.5">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${scoreTone(c.score)}`} />
              <span className="min-w-0 flex-1 truncate text-sm text-[#ede6da]" title={c.summary ?? undefined}>
                {c.applicant_name ?? "Candidate"}
              </span>
              <span className="shrink-0 text-sm font-semibold text-gold-300">{c.score}</span>
              {c.odoo_url && (
                <a href={c.odoo_url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-xs font-semibold text-gold-400 hover:text-gold-300">
                  Open →
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ThemeList({ title, items, tone }: { title: string; items: { label: string; count: number }[]; tone: "gap" | "strength" }) {
  if (items.length === 0) return <div />;
  const max = Math.max(1, ...items.map((i) => i.count));
  const bar = tone === "gap" ? "bg-gradient-to-r from-red-700/70 to-red-500/70" : "bg-gradient-to-r from-gold-700 to-gold-500";
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-[#8a7f6d]">{title}</p>
      <div className="mt-2 grid gap-1.5">
        {items.map((it) => (
          <div key={it.label} className="grid grid-cols-[1fr_auto] items-center gap-2">
            <div className="min-w-0">
              <p className="truncate text-xs text-[#d8cdb9]" title={it.label}>{it.label}</p>
              <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-ink-700">
                <div className={`h-full rounded-full ${bar}`} style={{ width: `${(it.count / max) * 100}%` }} />
              </div>
            </div>
            <span className="text-[11px] text-[#8a7f6d]">{it.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
