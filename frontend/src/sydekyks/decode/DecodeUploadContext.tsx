import { useCallback, useEffect, useState } from "react";
import { api, type DecodeJobsOut } from "../../lib/api";
import type { UploadContextProps } from "../registry";

/** Upload-context control for Decode: pick which open Odoo position the dropped résumés are for,
 * or let Decode infer it. Jobs come from the tenant's assigned Odoo (hr.job), with a refresh. */
export function DecodeUploadContext({ value, onChange }: UploadContextProps) {
  const [jobs, setJobs] = useState<DecodeJobsOut | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.get<DecodeJobsOut>("/tenant/decode/jobs").then((r) => setJobs(r.data)).catch(() => setJobs(null)).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const selected = value.job_id !== undefined ? String(value.job_id) : "auto";

  return (
    <div className="mb-3">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold uppercase tracking-wider text-gold-500">Applying for</label>
        <button type="button" onClick={load} className="text-xs font-semibold text-gold-400 hover:text-gold-300">
          {loading ? "Refreshing…" : "↻ Refresh"}
        </button>
      </div>
      <select
        className="mt-1 w-full rounded-md border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-[#ede6da] outline-none focus:border-gold-500"
        value={selected}
        onChange={(e) => (e.target.value === "auto" ? onChange({ job_source: "auto" }) : onChange({ job_id: Number(e.target.value) }))}
      >
        <option value="auto">🤖 Let Decode figure it out from the résumé</option>
        {(jobs?.jobs ?? []).map((j) => (
          <option key={j.id} value={j.id}>{j.name}</option>
        ))}
      </select>
      {jobs && !jobs.connected && (
        <p className="mt-1 text-xs text-amber-400/90">
          {jobs.message ?? "Odoo not connected"} - Decode will infer the position from each résumé.
        </p>
      )}
      {jobs && jobs.connected && jobs.jobs.length === 0 && (
        <p className="mt-1 text-xs text-[#8a7f6d]">No open positions in Odoo - applicants will be inferred or pooled.</p>
      )}
    </div>
  );
}
