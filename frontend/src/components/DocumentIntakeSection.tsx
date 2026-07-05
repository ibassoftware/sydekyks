import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Mission, type MissionDetail, type Sydekyk } from "../lib/api";
import { Badge } from "./ui";
import { FileDropZone } from "./FileDropZone";
import { LedgerMissionSummary } from "./LedgerMissionSummary";

function StatusBadge({ status }: { status: Mission["status"] }) {
  if (status === "succeeded") return <Badge tone="gold">Done</Badge>;
  if (status === "failed") return <Badge tone="danger">Failed</Badge>;
  if (status === "running")
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-gold-400">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gold-400" /> Running
      </span>
    );
  return <Badge tone="neutral">Queued</Badge>;
}

export function DocumentIntakeSection({ sydekyk, canManage }: { sydekyk: Sydekyk; canManage: boolean }) {
  const [missions, setMissions] = useState<Mission[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<MissionDetail | null>(null);

  const load = useCallback(() => {
    api.get<Mission[]>(`/tenant/sydekyks/${sydekyk.id}/missions`).then((res) => setMissions(res.data));
  }, [sydekyk.id]);

  useEffect(() => {
    load();
  }, [load]);

  // Poll while anything is in flight.
  const active = missions?.some((m) => m.status === "queued" || m.status === "running");
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      if (activeRef.current) load();
    }, 4000);
    return () => clearInterval(t);
  }, [active, load]);

  async function handleFiles(files: File[]) {
    if (!canManage) return;
    setUploading(true);
    setUploadError(null);
    try {
      const form = new FormData();
      files.forEach((f) => form.append("files", f));
      await api.post(`/tenant/sydekyks/${sydekyk.id}/documents`, form);
      load();
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setUploadError(detail ?? "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function toggle(missionId: string) {
    if (expanded === missionId) {
      setExpanded(null);
      setDetail(null);
      return;
    }
    setExpanded(missionId);
    setDetail(null);
    const res = await api.get<MissionDetail>(`/tenant/missions/${missionId}`);
    setDetail(res.data);
  }

  return (
    <div className="mt-6 border-t border-ink-700 pt-6">
      <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Upload Bills</p>

      {canManage ? (
        <div className="mt-3">
          <FileDropZone
            accept=".pdf,.png,.jpg,.jpeg,.webp"
            disabled={uploading}
            onFiles={handleFiles}
            hint={uploading ? "Uploading…" : "PDF, PNG, JPG or WEBP · up to 15MB each"}
          />
          {uploadError && <p className="mt-2 text-sm text-red-400">{uploadError}</p>}
        </div>
      ) : (
        <p className="mt-2 text-sm text-[#8a7f6d]">Your Commander can upload bills for {sydekyk.name}.</p>
      )}

      <div className="mt-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Recent Missions</p>
        {!missions ? (
          <p className="mt-2 text-sm text-[#8a7f6d]">Loading…</p>
        ) : missions.length === 0 ? (
          <p className="mt-2 text-sm text-[#8a7f6d]">No missions yet — drop a bill above to begin.</p>
        ) : (
          <div className="mt-2 divide-y divide-ink-700/60 overflow-hidden rounded-lg border border-ink-700">
            {missions.map((m) => (
              <div key={m.id}>
                <button
                  onClick={() => toggle(m.id)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-ink-800/50"
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-[#ede6da]">
                    {m.document_filename ?? "document"}
                  </span>
                  <StatusBadge status={m.status} />
                  <span className="text-xs text-[#8a7f6d]">{expanded === m.id ? "▲" : "▼"}</span>
                </button>

                {expanded === m.id && (
                  <div className="border-t border-ink-700/60 bg-ink-950/40 px-4 py-3">
                    {!detail ? (
                      <p className="text-sm text-[#8a7f6d]">Loading…</p>
                    ) : (
                      <MissionDetailPanel detail={detail} />
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MissionDetailPanel({ detail }: { detail: MissionDetail }) {
  return (
    <div className="grid gap-4">
      {detail.result_summary &&
        (detail.playbook_key === "ledger.vendor_bill_ingest" ? (
          <LedgerMissionSummary summary={detail.result_summary} />
        ) : (
          <GenericSummary summary={detail.result_summary} />
        ))}

      {detail.error_message && <p className="text-sm text-red-400">{detail.error_message}</p>}

      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-gold-500/80">Steps</p>
        <ol className="grid gap-1.5">
          {detail.steps.map((s) => (
            <li key={s.step_index} className="flex items-start gap-2 text-xs">
              <span
                className={`mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                  s.status === "succeeded"
                    ? "bg-gold-400"
                    : s.status === "failed"
                      ? "bg-red-500"
                      : s.status === "skipped"
                        ? "bg-ink-600"
                        : "bg-amber-500"
                }`}
              />
              <span className="text-[#b9ad98]">
                <span className="font-medium text-[#ede6da]">{s.step_key}</span> — {s.status}
                {s.error_message && <span className="text-red-400"> · {s.error_message}</span>}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function GenericSummary({ summary }: { summary: Record<string, unknown> }) {
  return (
    <div className="grid gap-1 text-xs">
      {Object.entries(summary).map(([k, v]) => (
        <div key={k} className="flex gap-2">
          <span className="text-[#8a7f6d]">{k}:</span>
          <span className="text-[#ede6da]">{String(v)}</span>
        </div>
      ))}
    </div>
  );
}
