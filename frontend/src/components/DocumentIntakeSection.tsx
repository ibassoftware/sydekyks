import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { api, type LedgerReadiness, type Mission, type Sydekyk } from "../lib/api";
import { FileDropZone } from "./FileDropZone";
import { MissionList } from "./MissionList";
import type { UploadContextProps } from "../sydekyks/registry";

export function DocumentIntakeSection({
  sydekyk,
  canManage,
  readiness,
  uploadContext: UploadContext,
}: {
  sydekyk: Sydekyk;
  canManage: boolean;
  readiness?: LedgerReadiness | null;
  uploadContext?: ComponentType<UploadContextProps>;
}) {
  const [missions, setMissions] = useState<Mission[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadCtx, setUploadCtx] = useState<Record<string, unknown>>({});

  const load = useCallback(() => {
    api.get<Mission[]>(`/tenant/sydekyks/${sydekyk.id}/missions`).then((res) => setMissions(res.data));
  }, [sydekyk.id]);

  useEffect(() => {
    load();
  }, [load]);

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
      if (Object.keys(uploadCtx).length > 0) form.append("context", JSON.stringify(uploadCtx));
      await api.post(`/tenant/sydekyks/${sydekyk.id}/documents`, form);
      load();
    } catch (err) {
      const d = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setUploadError(d ?? "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  // VS-1: block upload until required readiness items pass (when readiness is known for this Sydekyk).
  const uploadBlocked = readiness ? !readiness.can_upload : false;

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Upload</p>

      {!canManage ? (
        <p className="mt-2 text-sm text-[#8a7f6d]">Your Commander can upload documents for {sydekyk.name}.</p>
      ) : uploadBlocked ? (
        <p className="mt-2 text-sm text-amber-400/90">Finish the required setup above before uploading.</p>
      ) : (
        <div className="mt-3">
          {UploadContext && <UploadContext value={uploadCtx} onChange={setUploadCtx} />}
          <FileDropZone
            accept=".pdf,.png,.jpg,.jpeg,.webp"
            disabled={uploading}
            onFiles={handleFiles}
            hint={uploading ? "Uploading…" : "PDF, PNG, JPG or WEBP · up to 15MB each"}
          />
          {uploadError && <p className="mt-2 text-sm text-red-400">{uploadError}</p>}
        </div>
      )}

      <div className="mt-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Recent Missions</p>
        {!missions ? (
          <p className="mt-2 text-sm text-[#8a7f6d]">Loading…</p>
        ) : missions.length === 0 ? (
          <p className="mt-2 text-sm text-[#8a7f6d]">No missions yet — drop a file above to begin.</p>
        ) : (
          <div className="mt-2 overflow-hidden rounded-lg border border-ink-700">
            <MissionList missions={missions} onReload={load} showSydekyk={false} />
          </div>
        )}
      </div>
    </div>
  );
}
