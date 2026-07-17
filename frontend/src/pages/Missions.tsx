import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { api, type MissionPage, type Sydekyk } from "../lib/api";
import { useActivity } from "../lib/activity";
import { Button, Card, Input } from "../components/ui";
import { HQShell } from "../components/HQShell";
import { MissionList } from "../components/MissionList";
import { AttentionWorkspace } from "../components/AttentionWorkspace";
import { ChevronRightIcon } from "../components/icons";

const PAGE_SIZE = 25;

type MissionView = "all" | "attention" | "running" | "done" | "failed";
const MISSION_VIEWS: { key: MissionView; label: string }[] = [
  { key: "all", label: "All missions" },
  { key: "attention", label: "Needs attention" },
  { key: "running", label: "Running" },
  { key: "done", label: "Completed" },
  { key: "failed", label: "Failed" },
];

function parseView(value: string | null): MissionView {
  return MISSION_VIEWS.some((item) => item.key === value) ? value as MissionView : "all";
}

export default function Missions() {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = parseView(searchParams.get("view"));
  const sydekykId = searchParams.get("sydekyk_id") ?? "";
  const focusMission = searchParams.get("mission");
  const { issuesCount } = useActivity();
  const [page, setPage] = useState<MissionPage | null>(null);
  const [source, setSource] = useState("");
  const [filename, setFilename] = useState("");
  const [offset, setOffset] = useState(0);
  const [sydekyks, setSydekyks] = useState<Sydekyk[]>([]);

  useEffect(() => {
    api.get<Sydekyk[]>("/tenant/sydekyks").then((response) => setSydekyks(response.data)).catch(() => setSydekyks([]));
  }, []);

  const load = useCallback(() => {
    if (view === "attention") return;
    const params: Record<string, string | number> = { limit: PAGE_SIZE, offset };
    if (view === "running") params.status = "running";
    else if (view === "done") params.status = "succeeded";
    else if (view === "failed") params.status = "failed";
    if (sydekykId) params.sydekyk_id = sydekykId;
    if (source) params.source = source;
    if (filename) params.filename = filename;
    api.get<MissionPage>("/tenant/missions", { params }).then((response) => setPage(response.data));
  }, [view, sydekykId, source, filename, offset]);

  useEffect(() => {
    if (view === "attention") setPage(null);
    else load();
  }, [load, view]);

  function changeView(nextView: MissionView) {
    setOffset(0);
    const next = new URLSearchParams(searchParams);
    if (nextView === "all") next.delete("view");
    else next.set("view", nextView);
    if (nextView !== "attention") next.delete("mission");
    setSearchParams(next);
  }

  function changeSydekyk(id: string) {
    setOffset(0);
    const next = new URLSearchParams(searchParams);
    if (id) next.set("sydekyk_id", id);
    else next.delete("sydekyk_id");
    setSearchParams(next);
  }

  function clearFilters() {
    setOffset(0);
    setSource("");
    setFilename("");
    const next = new URLSearchParams(searchParams);
    next.delete("view");
    next.delete("sydekyk_id");
    next.delete("mission");
    setSearchParams(next);
  }

  const hasFilters = view !== "all" || Boolean(sydekykId || source || filename);

  function exportCsv() {
    const params = new URLSearchParams();
    if (view === "running") params.set("status", "running");
    else if (view === "done") params.set("status", "succeeded");
    else if (view === "failed") params.set("status", "failed");
    if (sydekykId) params.set("sydekyk_id", sydekykId);
    if (source) params.set("source", source);
    if (filename) params.set("filename", filename);
    const token = localStorage.getItem("sydekyks_token") ?? "";
    fetch(`/api/tenant/missions/export?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => response.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "missions.csv";
        link.click();
        URL.revokeObjectURL(url);
      });
  }

  const total = page?.total ?? 0;
  const pageEnd = Math.min(offset + PAGE_SIZE, total);

  return (
    <HQShell>
      <main id="main-content" className="mx-auto min-w-0 max-w-6xl px-6 py-12">
        <header className="flex flex-col gap-8 border-b-2 border-ink-600 pb-8 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-[0.4px] text-gold-300">Operations</p>
            <h1 className="mt-4 text-[28px] font-bold leading-none text-heading">Missions</h1>
            <p className="mt-4 max-w-[65ch] text-base leading-7 text-body">
              Follow every assignment from dispatch to outcome. Work that needs a human decision or a setup fix now lives in the same mission command.
            </p>
          </div>
          {view !== "attention" && <Button variant="ghost" onClick={exportCsv}>Export mission log</Button>}
        </header>

        <div role="group" aria-label="Mission views" className="mt-8 flex flex-wrap border-b-2 border-ink-600">
          {MISSION_VIEWS.map((item) => {
            const active = view === item.key;
            return (
              <button
                type="button"
                key={item.key}
                aria-pressed={active}
                onClick={() => changeView(item.key)}
                className={`inline-flex min-h-11 shrink-0 items-center gap-2 border-b-[3px] px-4 py-3 text-base font-medium transition-colors ${
                  active ? "border-gold-400 text-gold-300" : "border-transparent text-body hover:border-ink-500 hover:text-heading"
                }`}
              >
                {item.label}
                {item.key === "attention" && issuesCount > 0 && (
                  <span className="rounded-[2px] border-2 border-warning bg-warning-soft px-2 py-0.5 text-xs text-warning-fg">{issuesCount}</span>
                )}
              </button>
            );
          })}
        </div>

        {view === "attention" ? (
          <AttentionWorkspace
            sydekyks={sydekyks}
            sydekykId={sydekykId}
            focusMission={focusMission}
            onSydekykChange={changeSydekyk}
          />
        ) : (
          <>
            <Card className="mt-8 p-5">
              <div className="grid min-w-0 gap-6 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(14rem,2fr)_auto] xl:items-end">
                <SelectFilter label="Agent" value={sydekykId} onChange={changeSydekyk}>
                  <option value="">All agents</option>
                  {sydekyks.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                </SelectFilter>
                <SelectFilter label="Source" value={source} onChange={(value) => { setOffset(0); setSource(value); }}>
                  <option value="">Any source</option>
                  <option value="web_upload">Web upload</option>
                  <option value="email">Email</option>
                </SelectFilter>
                <div className="min-w-0">
                  <label htmlFor="mission-filename" className="mb-2 block text-sm font-medium text-heading">Filename</label>
                  <Input
                    id="mission-filename"
                    value={filename}
                    onChange={(event) => { setOffset(0); setFilename(event.target.value); }}
                    placeholder="Search filename"
                  />
                </div>
                {hasFilters && <Button variant="ghost" onClick={clearFilters}>Clear filters</Button>}
              </div>
            </Card>

            <Card className="mt-6 min-w-0 overflow-hidden">
              {!page ? (
                <p className="p-6 text-base text-body" role="status">Loading mission log…</p>
              ) : page.items.length === 0 ? (
                <div className="p-8 text-center">
                  <h2 className="text-xl font-bold text-heading">No missions match this view</h2>
                  <p className="mt-4 text-base text-body">Adjust the filters or return to all missions.</p>
                </div>
              ) : (
                <MissionList missions={page.items} onReload={load} />
              )}
            </Card>

            {page && total > 0 && (
              <div className="mt-6 flex flex-col gap-4 text-sm text-body sm:flex-row sm:items-center sm:justify-between">
                <span>{offset + 1}–{pageEnd} of {total}</span>
                <div className="flex flex-wrap gap-4">
                  <Button variant="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Previous</Button>
                  <Button variant="ghost" disabled={pageEnd >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>Next</Button>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </HQShell>
  );
}

function SelectFilter({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  const id = `mission-filter-${label.toLowerCase()}`;
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-2 block text-sm font-medium text-heading">{label}</label>
      <div className="relative">
        <select
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-full appearance-none rounded-[4px] border-2 border-ink-600 bg-ink-800 px-4 py-3 pr-12 text-base text-heading focus:border-gold-500"
        >
          {children}
        </select>
        <ChevronRightIcon className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 rotate-90 text-body" />
      </div>
    </div>
  );
}
