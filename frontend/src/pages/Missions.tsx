import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, type MissionDetail, type MissionPage, type MissionStatus } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Badge, Button, Card, PageShell } from "../components/ui";
import { MissionDetailPanel } from "../components/DocumentIntakeSection";

const PAGE_SIZE = 25;

function StatusBadge({ status }: { status: MissionStatus }) {
  if (status === "succeeded") return <Badge tone="gold">Done</Badge>;
  if (status === "failed") return <Badge tone="danger">Failed</Badge>;
  if (status === "running") return <Badge tone="neutral">Running</Badge>;
  return <Badge tone="neutral">Queued</Badge>;
}

export default function Missions() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const canManage = user?.role === "commander";

  const [page, setPage] = useState<MissionPage | null>(null);
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [filename, setFilename] = useState("");
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<MissionDetail | null>(null);

  const load = useCallback(() => {
    const params: Record<string, string | number> = { limit: PAGE_SIZE, offset };
    if (status) params.status = status;
    if (source) params.source = source;
    if (filename) params.filename = filename;
    api.get<MissionPage>("/tenant/missions", { params }).then((res) => setPage(res.data));
  }, [status, source, filename, offset]);

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
    const res = await api.get<MissionDetail>(`/tenant/missions/${id}`);
    setDetail(res.data);
  }

  function exportCsv() {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (source) params.set("source", source);
    if (filename) params.set("filename", filename);
    const token = localStorage.getItem("sydekyks_token") ?? "";
    // Fetch with auth then trigger a client-side download (the CSV route needs the bearer token).
    fetch(`/api/tenant/missions/export?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "missions.csv";
        a.click();
        URL.revokeObjectURL(url);
      });
  }

  const selectClass =
    "rounded-md border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-[#ede6da] outline-none focus:border-gold-500";

  const total = page?.total ?? 0;
  const pageEnd = Math.min(offset + PAGE_SIZE, total);

  return (
    <PageShell>
      <header className="border-b border-ink-700 bg-ink-900/60">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/hq" className="flex items-center gap-2 text-lg font-bold tracking-wide text-gold-300">
            <span className="text-2xl">⚡</span> SYDEKYKS
          </Link>
          <div className="flex items-center gap-4">
            <Link to="/hq/roster" className="text-sm font-semibold text-gold-400 hover:text-gold-300">Roster</Link>
            <Link to="/hq/gadgets" className="text-sm font-semibold text-gold-400 hover:text-gold-300">Gadgets</Link>
            <span className="text-sm text-[#b9ad98]">{user?.email}</span>
            <Button variant="ghost" onClick={() => { logout(); navigate("/login"); }}>Log out</Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-gold-500">Operations</p>
            <h1 className="mt-1 text-3xl font-bold text-[#f5eee0]">Missions</h1>
          </div>
          <Button variant="ghost" onClick={exportCsv}>Export CSV</Button>
        </div>

        <Card className="mt-6 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <select className={selectClass} value={status} onChange={(e) => { setOffset(0); setStatus(e.target.value); }}>
              <option value="">All statuses</option>
              <option value="queued">Queued</option>
              <option value="running">Running</option>
              <option value="succeeded">Succeeded</option>
              <option value="failed">Failed</option>
            </select>
            <select className={selectClass} value={source} onChange={(e) => { setOffset(0); setSource(e.target.value); }}>
              <option value="">All sources</option>
              <option value="web_upload">Web upload</option>
              <option value="email">Email</option>
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
                  <button onClick={() => toggle(m.id)} className="grid w-full grid-cols-[1fr_auto] items-center gap-3 px-5 py-3 text-left hover:bg-ink-800/50">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-[#ede6da]">{m.document_filename ?? "document"}</p>
                      <p className="truncate text-xs text-[#8a7f6d]">
                        {m.sydekyk_name ?? "—"} · {m.source ?? m.signal_type} · {new Date(m.created_at).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {m.source === "email" && <Badge tone="neutral">Email</Badge>}
                      <StatusBadge status={m.status} />
                    </div>
                  </button>
                  {expanded === m.id && (
                    <div className="border-t border-ink-700/60 bg-ink-950/40 px-5 py-3">
                      {!detail ? (
                        <p className="text-sm text-[#8a7f6d]">Loading…</p>
                      ) : (
                        <MissionDetailPanel detail={detail} canManage={canManage} onChanged={load} />
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
