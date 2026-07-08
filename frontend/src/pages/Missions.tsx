import { useCallback, useEffect, useState } from "react";
import { api, type MissionPage, type Sydekyk } from "../lib/api";
import { Button, Card } from "../components/ui";
import { HQShell } from "../components/HQShell";
import { MissionList } from "../components/MissionList";

const PAGE_SIZE = 25;

type Quick = "all" | "needs_review" | "running" | "done" | "failed";
const QUICK_TABS: { key: Quick; label: string }[] = [
  { key: "all", label: "All" },
  { key: "needs_review", label: "Needs review" },
  { key: "running", label: "Running" },
  { key: "done", label: "Done" },
  { key: "failed", label: "Failed" },
];

export default function Missions() {
  const [page, setPage] = useState<MissionPage | null>(null);
  const [quick, setQuick] = useState<Quick>("all");
  const [sydekykId, setSydekykId] = useState("");
  const [source, setSource] = useState("");
  const [filename, setFilename] = useState("");
  const [offset, setOffset] = useState(0);
  const [sydekyks, setSydekyks] = useState<Sydekyk[]>([]);

  useEffect(() => {
    api.get<Sydekyk[]>("/tenant/sydekyks").then((r) => setSydekyks(r.data)).catch(() => setSydekyks([]));
  }, []);

  const load = useCallback(() => {
    const params: Record<string, string | number | boolean> = { limit: PAGE_SIZE, offset };
    if (quick === "needs_review") params.needs_review = true;
    else if (quick === "running") params.status = "running";
    else if (quick === "done") params.status = "succeeded";
    else if (quick === "failed") params.status = "failed";
    if (sydekykId) params.sydekyk_id = sydekykId;
    if (source) params.source = source;
    if (filename) params.filename = filename;
    api.get<MissionPage>("/tenant/missions", { params }).then((res) => setPage(res.data));
  }, [quick, sydekykId, source, filename, offset]);

  useEffect(() => {
    load();
  }, [load]);

  function changeFilter(fn: () => void) {
    setOffset(0);
    fn();
  }

  const hasFilters = quick !== "all" || !!sydekykId || !!source || !!filename;

  function exportCsv() {
    const params = new URLSearchParams();
    if (quick === "running") params.set("status", "running");
    else if (quick === "done") params.set("status", "succeeded");
    else if (quick === "failed") params.set("status", "failed");
    else if (quick === "needs_review") params.set("needs_review", "true");
    if (sydekykId) params.set("sydekyk_id", sydekykId);
    if (source) params.set("source", source);
    if (filename) params.set("filename", filename);
    const token = localStorage.getItem("sydekyks_token") ?? "";
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
    <HQShell>
      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-gold-500">Operations</p>
            <h1 className="mt-1 text-3xl font-bold text-[#f5eee0]">Missions</h1>
          </div>
          <Button variant="ghost" onClick={exportCsv}>Export CSV</Button>
        </div>

        {/* Quick status tabs */}
        <div className="mt-6 flex flex-wrap gap-2">
          {QUICK_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => changeFilter(() => setQuick(t.key))}
              className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                quick === t.key
                  ? "border-gold-500/60 bg-gold-500/15 text-gold-300"
                  : "border-ink-600 bg-ink-900/60 text-[#a89a82] hover:bg-ink-800/70 hover:text-[#ede6da]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Secondary filters */}
        <Card className="mt-4 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <select className={selectClass} value={sydekykId} onChange={(e) => changeFilter(() => setSydekykId(e.target.value))}>
              <option value="">All Sydekyks</option>
              {sydekyks.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <select className={selectClass} value={source} onChange={(e) => changeFilter(() => setSource(e.target.value))}>
              <option value="">Any source</option>
              <option value="web_upload">Web upload</option>
              <option value="email">Email</option>
            </select>
            <input
              className={selectClass + " min-w-[200px] flex-1"}
              placeholder="Search filename…"
              value={filename}
              onChange={(e) => changeFilter(() => setFilename(e.target.value))}
            />
            {hasFilters && (
              <Button
                variant="ghost"
                className="px-3 py-1.5 text-xs"
                onClick={() => changeFilter(() => { setQuick("all"); setSydekykId(""); setSource(""); setFilename(""); })}
              >
                Clear filters
              </Button>
            )}
          </div>
        </Card>

        <Card className="mt-4 overflow-hidden">
          {!page ? (
            <p className="p-6 text-sm text-[#8a7f6d]">Loading…</p>
          ) : page.items.length === 0 ? (
            <p className="p-6 text-sm text-[#8a7f6d]">No missions match these filters.</p>
          ) : (
            <MissionList missions={page.items} onReload={load} />
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
    </HQShell>
  );
}
