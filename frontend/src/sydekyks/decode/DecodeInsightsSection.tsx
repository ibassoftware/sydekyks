import { useEffect, useState } from "react";
import { api, type DecodeInsights } from "../../lib/api";
import { Card } from "../../components/ui";

/** Recruitment (parsing) dashboard card — renders only when Decode is installed and has data. */
export function DecodeInsightsSection() {
  const [data, setData] = useState<DecodeInsights | null>(null);

  useEffect(() => {
    api.get<DecodeInsights>("/tenant/decode/insights").then((r) => setData(r.data)).catch(() => setData(null));
  }, []);

  if (!data || !data.activated || data.total_applicants === 0) return null;

  return (
    <Card className="relative mt-6 overflow-hidden p-6">
      <div className="relative flex items-center gap-2">
        <span className="text-lg">🧑‍💼</span>
        <p className="text-xs font-semibold uppercase tracking-widest text-gold-500">Decode — Résumés parsed</p>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Tile value={data.total_applicants} label="Applicants" />
        <Tile value={data.with_job_count} label="Matched to a job" />
        <Tile value={data.pooling_count} label="Pooled" />
        <Tile value={data.needs_review_count} label="Needs review" />
      </div>
      {data.top_skills.length > 0 && (
        <div className="mt-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#8a7f6d]">Top skills</p>
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
