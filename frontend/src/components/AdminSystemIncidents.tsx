import { useCallback, useEffect, useState } from "react";
import { api, type SystemIncidentPage } from "../lib/api";
import { Badge, Button, Card } from "./ui";
import { WarningIcon } from "./icons";

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function AdminSystemIncidents() {
  const [page, setPage] = useState<SystemIncidentPage | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [resolving, setResolving] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<SystemIncidentPage>("/admin/incidents", { params: { limit: 30, include_resolved: showResolved } })
      .then((response) => setPage(response.data));
  }, [showResolved]);

  useEffect(() => { load(); }, [load]);

  async function resolve(id: string) {
    setResolving(id);
    try {
      await api.post(`/admin/incidents/${id}/resolve`);
      load();
    } finally {
      setResolving(null);
    }
  }

  return (
    <section aria-labelledby="system-incidents-title" className="mb-10">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.4px] text-red-400">System watch</p>
          <h1 id="system-incidents-title" className="mt-2 text-2xl font-bold text-heading">Failures requiring command</h1>
          <p className="mt-2 max-w-[65ch] text-sm text-body">Unhandled API, database, integration, and mission-run failures appear here with operator diagnostics.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="ghost" onClick={() => setShowResolved((value) => !value)}>{showResolved ? "Hide resolved" : "Show resolved"}</Button>
          <Button variant="ghost" onClick={load}>Refresh watch</Button>
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b-2 border-ink-600 bg-ink-900 p-4">
          <span className="grid h-11 w-11 place-items-center rounded-[4px] border-2 border-red-700/50 bg-red-500/10 text-red-400">
            <WarningIcon className="h-5 w-5" />
          </span>
          <div>
            <p className="text-2xl font-bold tabular-nums text-heading">{page?.open_count ?? " - "}</p>
            <p className="text-xs font-medium uppercase tracking-[0.4px] text-body">Open system incidents</p>
          </div>
          {(page?.memory_fallback_count ?? 0) > 0 && (
            <Badge tone="danger">{page?.memory_fallback_count} held in emergency memory</Badge>
          )}
        </div>

        {!page ? (
          <p className="p-5 text-sm text-body" role="status">Checking system watch…</p>
        ) : page.items.length === 0 ? (
          <div className="p-6">
            <p className="text-base font-semibold text-heading">Systems are holding</p>
            <p className="mt-2 text-sm text-body">No {showResolved ? "recorded" : "open"} system failures match this view.</p>
          </div>
        ) : (
          <div className="grid min-w-0 gap-2 p-2">
            {page.items.map((incident) => (
              <details key={incident.id} className="min-w-0 rounded-[4px] border-2 border-l-4 border-ink-600 border-l-red-500 bg-ink-950/40">
                <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-3 p-4 marker:content-none">
                  <Badge tone={incident.resolved ? "neutral" : "danger"}>{incident.resolved ? "Resolved" : `HTTP ${incident.status_code}`}</Badge>
                  <span className="min-w-0 flex-1 break-words text-base font-semibold text-heading">{incident.error_type}: {incident.message}</span>
                  <span className="text-sm text-body">{when(incident.created_at)}</span>
                </summary>
                <div className="min-w-0 border-t-2 border-ink-600 bg-ink-900 p-4">
                  <dl className="grid min-w-0 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                    <IncidentField label="Source" value={incident.source} />
                    <IncidentField label="HQ" value={incident.tenant_name ?? incident.tenant_id ?? "Platform"} />
                    <IncidentField label="Request" value={[incident.method, incident.path].filter(Boolean).join(" ") || "Background task"} />
                    <IncidentField label="Mission" value={incident.mission_id ?? " - "} />
                  </dl>
                  {incident.traceback && (
                    <pre className="mt-4 max-h-72 max-w-full overflow-auto whitespace-pre-wrap break-all rounded-[4px] border-2 border-ink-700 bg-ink-950 p-4 text-xs leading-5 text-body">
                      {incident.traceback}
                    </pre>
                  )}
                  {!incident.resolved && (
                    <div className="mt-4 flex justify-end">
                      <Button variant="ghost" disabled={resolving === incident.id} onClick={() => resolve(incident.id)}>
                        {resolving === incident.id ? "Resolving…" : "Mark resolved"}
                      </Button>
                    </div>
                  )}
                </div>
              </details>
            ))}
          </div>
        )}
      </Card>
    </section>
  );
}

function IncidentField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-[0.4px] text-body">{label}</dt>
      <dd className="mt-1 break-all text-heading">{value}</dd>
    </div>
  );
}
