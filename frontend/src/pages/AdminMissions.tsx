import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, type Mission, type MissionDetail, type MissionPage, type Tenant } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Badge, Button, Card, PageShell } from "../components/ui";

const PAGE_SIZE = 25;

function StatusBadge({ status }: { status: Mission["status"] }) {
  if (status === "succeeded") return <Badge tone="gold">Done</Badge>;
  if (status === "failed") return <Badge tone="danger">Failed</Badge>;
  if (status === "running") return <Badge tone="neutral">Running</Badge>;
  return <Badge tone="neutral">Queued</Badge>;
}

export default function AdminMissions() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [page, setPage] = useState<MissionPage | null>(null);
  const [tenantId, setTenantId] = useState("");
  const [status, setStatus] = useState("");
  const [filename, setFilename] = useState("");
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<MissionDetail | null>(null);

  useEffect(() => {
    api.get<Tenant[]>("/admin/tenants").then((res) => setTenants(res.data));
  }, []);

  const load = useCallback(() => {
    const params: Record<string, string | number> = { limit: PAGE_SIZE, offset };
    if (tenantId) params.tenant_id = tenantId;
    if (status) params.status = status;
    if (filename) params.filename = filename;
    api.get<MissionPage>("/admin/missions", { params }).then((res) => setPage(res.data));
  }, [tenantId, status, filename, offset]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggle(id: string) {
    if (expanded === id) {
      setExpanded(null);
      setDetail(null);
      return;
    }
    setExpanded(id);
    setDetail(null);
    const res = await api.get<MissionDetail>(`/admin/missions/${id}`);
    setDetail(res.data);
  }

  const selectClass =
    "rounded-md border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-[#ede6da] outline-none focus:border-gold-500";
  const total = page?.total ?? 0;
  const pageEnd = Math.min(offset + PAGE_SIZE, total);

  return (
    <PageShell>
      <header className="border-b border-ink-700 bg-ink-900/60">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2 text-lg font-bold tracking-wide text-gold-300">
            <span className="text-2xl">⚡</span> SYDEKYKS{" "}
            <span className="ml-2 rounded border border-gold-700/50 px-2 py-0.5 text-xs font-semibold text-gold-400">
              Command Center
            </span>
          </div>
          <div className="flex items-center gap-4">
            <Link to="/admin" className="text-sm font-semibold text-gold-400 hover:text-gold-300">HQs</Link>
            <Button variant="ghost" onClick={() => { logout(); navigate("/login"); }}>Log out</Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        <h1 className="text-2xl font-bold text-[#f5eee0]">All Missions</h1>
        <p className="mt-1 text-sm text-[#b9ad98]">
          Every Mission across every HQ, with full unsanitized error detail for debugging.
        </p>

        <Card className="mt-6 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <select className={selectClass} value={tenantId} onChange={(e) => { setOffset(0); setTenantId(e.target.value); }}>
              <option value="">All HQs</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <select className={selectClass} value={status} onChange={(e) => { setOffset(0); setStatus(e.target.value); }}>
              <option value="">All statuses</option>
              <option value="queued">Queued</option>
              <option value="running">Running</option>
              <option value="succeeded">Succeeded</option>
              <option value="failed">Failed</option>
            </select>
            <input
              className={selectClass + " min-w-[200px] flex-1"}
              placeholder="Search filename…"
              value={filename}
              onChange={(e) => { setOffset(0); setFilename(e.target.value); }}
            />
          </div>
        </Card>

        <Card className="mt-4 overflow-hidden">
          {!page ? (
            <p className="p-6 text-sm text-[#8a7f6d]">Loading…</p>
          ) : page.items.length === 0 ? (
            <p className="p-6 text-sm text-[#8a7f6d]">No missions match these filters.</p>
          ) : (
            <div className="divide-y divide-ink-700/60">
              {page.items.map((m) => (
                <div key={m.id}>
                  <button
                    onClick={() => toggle(m.id)}
                    className="grid w-full grid-cols-[1fr_auto] items-center gap-3 px-5 py-3 text-left hover:bg-ink-800/50"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm text-[#ede6da]">{m.document_filename ?? "document"}</p>
                      <p className="truncate text-xs text-[#8a7f6d]">
                        {m.tenant_name ?? "—"} · {m.sydekyk_name ?? "—"} · {m.source ?? m.signal_type} ·{" "}
                        {new Date(m.created_at).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {m.failure_category && <Badge tone="neutral">{m.failure_category}</Badge>}
                      <StatusBadge status={m.status} />
                    </div>
                  </button>
                  {expanded === m.id && (
                    <div className="border-t border-ink-700/60 bg-ink-950/40 px-5 py-3">
                      {!detail ? (
                        <p className="text-sm text-[#8a7f6d]">Loading…</p>
                      ) : (
                        <AdminMissionDetail detail={detail} />
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        {page && total > 0 && (
          <div className="mt-4 flex items-center justify-between text-sm text-[#8a7f6d]">
            <span>{offset + 1}–{pageEnd} of {total}</span>
            <div className="flex gap-2">
              <Button variant="ghost" className="px-3 py-1.5 text-xs" disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Previous</Button>
              <Button variant="ghost" className="px-3 py-1.5 text-xs" disabled={pageEnd >= total}
                onClick={() => setOffset(offset + PAGE_SIZE)}>Next</Button>
            </div>
          </div>
        )}
      </main>
    </PageShell>
  );
}

/** Admin detail view — unlike the tenant MissionDetailPanel, shows raw error text and has no
 * Retry button (retry is a tenant-scoped action; admins direct the tenant to retry instead). */
function AdminMissionDetail({ detail }: { detail: MissionDetail }) {
  return (
    <div className="grid gap-4">
      {detail.result_summary && (
        <div className="grid gap-1 text-xs">
          {Object.entries(detail.result_summary).map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <span className="text-[#8a7f6d]">{k}:</span>
              <span className="text-[#ede6da]">{String(v)}</span>
            </div>
          ))}
        </div>
      )}

      {detail.odoo_bill_url && (
        <a
          href={detail.odoo_bill_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-fit items-center gap-1 text-xs font-semibold text-gold-400 hover:text-gold-300"
        >
          Open bill in Odoo →
        </a>
      )}

      {detail.error_message && (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-red-400/80">Raw error</p>
          <pre className="whitespace-pre-wrap break-words rounded-md border border-red-900/40 bg-red-950/20 p-3 text-xs text-red-300">
            {detail.error_message}
          </pre>
        </div>
      )}

      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-gold-500/80">Steps</p>
        <ol className="grid gap-1.5">
          {detail.steps.map((s) => (
            <li key={s.step_index} className="text-xs">
              <div className="flex items-start gap-2">
                <span
                  className={`mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                    s.status === "succeeded" ? "bg-gold-400" : s.status === "failed" ? "bg-red-500" : "bg-amber-500"
                  }`}
                />
                <span className="font-medium text-[#ede6da]">{s.step_key}</span>
                <span className="text-[#8a7f6d]">— {s.status}</span>
              </div>
              {s.error_message && (
                <pre className="ml-3.5 mt-1 whitespace-pre-wrap break-words rounded border border-red-900/30 bg-red-950/10 p-2 text-[11px] text-red-300">
                  {s.error_message}
                </pre>
              )}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
