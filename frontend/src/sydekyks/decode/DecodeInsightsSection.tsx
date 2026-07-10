import { useEffect, useState } from "react";
import { api, type DecodeInsights } from "../../lib/api";
import { formatWorkTime, formatFastTime } from "../../lib/format";
import { Card } from "../../components/ui";
import { AgentThumb } from "../../components/AgentThumb";

const money = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });

/** Recruitment (parsing) dashboard card — an intake monitor: where applicants are landing, how
 * clean the captured data is, the seniority mix, and the skills the pool brings. */
export function DecodeInsightsSection() {
  const [data, setData] = useState<DecodeInsights | null>(null);

  useEffect(() => {
    api.get<DecodeInsights>("/tenant/decode/insights").then((r) => setData(r.data)).catch(() => setData(null));
  }, []);

  if (!data || !data.activated || data.total_applicants === 0) return null;

  return (
    <Card className="relative mt-6 overflow-hidden p-6">
      <div className="relative flex items-center gap-3">
        <AgentThumb slug="decode" alt="Decode" />
        <div>
          <p className="text-sm font-bold text-[#f5eee0]">Decode</p>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-gold-500">Résumés parsed · Live</p>
        </div>
      </div>

      <div className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#8a7f6d]">Estimated $ saved</p>
        <p className="mt-1 text-4xl font-bold text-[#f5eee0]">${money(data.estimated_net_savings)}</p>
        <p className="mt-1 text-xs text-[#8a7f6d]">
          ${money(data.estimated_manual_cost)} manual data entry avoided − ${money(data.ai_cost)} AI cost
        </p>
        <p className="mt-2 text-sm font-medium text-gold-300">
          {data.total_applicants.toLocaleString()} résumés parsed in {formatFastTime(data.processing_seconds)}
          <span className="font-normal text-[#8a7f6d]">
            {" "}· ~{formatWorkTime(data.total_applicants * data.estimated_minutes_each)} by hand
          </span>
        </p>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Tile value={data.total_applicants} label="Applicants" />
        <Tile value={data.with_job_count} label="Matched to a job" />
        <Tile value={data.pooling_count} label="Pooled (unrouted)" />
        <Tile value={data.needs_review_count} label="Needs review" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Where interest is landing — and how big the unrouted pool is. */}
        {data.applications_by_position.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[#8a7f6d]">Applications by position</p>
            <Bars
              items={data.applications_by_position.map((p) => ({ label: p.job_name, count: p.count }))}
              highlight="Pool"
            />
          </div>
        )}

        {/* Seniority mix of the inbound pool. */}
        {data.seniority_mix.some((s) => s.count > 0) && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[#8a7f6d]">Seniority mix</p>
            <Bars items={data.seniority_mix.map((s) => ({ label: s.band, count: s.count }))} />
          </div>
        )}
      </div>

      {/* Trust: how complete is the data landing in Odoo. */}
      {data.data_quality && (
        <div className="mt-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#8a7f6d]">Data captured</p>
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <QualityTile pct={data.data_quality.with_email} label="Email" />
            <QualityTile pct={data.data_quality.with_phone} label="Phone" />
            <QualityTile pct={data.data_quality.with_skills} label="Skills" />
            <QualityTile pct={data.data_quality.with_experience} label="Experience" />
            <QualityTile pct={data.data_quality.needs_review} label="Needs review" invert />
          </div>
        </div>
      )}

      {data.top_skills.length > 0 && (
        <div className="mt-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#8a7f6d]">Top skills in the pool</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {data.top_skills.map((s) => (
              <span key={s.skill} className="rounded-full border border-ink-600 bg-ink-800/60 px-2.5 py-1 text-xs text-[#d8cdb9]">
                {s.skill} <span className="text-[#8a7f6d]">· {s.count}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function Tile({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <p className="text-2xl font-bold text-[#f5eee0]">{value.toLocaleString()}</p>
      <p className="text-[11px] text-[#8a7f6d]">{label}</p>
    </div>
  );
}

function QualityTile({ pct, label, invert }: { pct: number; label: string; invert?: boolean }) {
  // For "captured" fields high is good; for "needs review" high is bad → tint accordingly.
  const good = invert ? pct <= 15 : pct >= 80;
  const tone = good ? "text-gold-300" : pct >= 50 && !invert ? "text-[#ede6da]" : invert && pct <= 40 ? "text-[#ede6da]" : "text-amber-400";
  return (
    <div>
      <p className={`text-xl font-bold ${tone}`}>{pct}%</p>
      <p className="text-[11px] text-[#8a7f6d]">{label}</p>
    </div>
  );
}

function Bars({ items, highlight }: { items: { label: string; count: number }[]; highlight?: string }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <div className="mt-2 grid gap-1.5">
      {items.map((it) => (
        <div key={it.label} className="flex items-center gap-2">
          <span className="w-28 shrink-0 truncate text-[11px] text-[#8a7f6d]" title={it.label}>{it.label}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-700">
            <div
              className={`h-full rounded-full ${it.label === highlight ? "bg-gradient-to-r from-amber-600 to-amber-400" : "bg-gradient-to-r from-gold-600 to-gold-400"}`}
              style={{ width: `${(it.count / max) * 100}%` }}
            />
          </div>
          <span className="w-6 text-right text-[11px] text-[#b9ad98]">{it.count}</span>
        </div>
      ))}
    </div>
  );
}
