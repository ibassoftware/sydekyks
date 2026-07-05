import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Sydekyk } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Badge, Button, Card, Modal, PageShell } from "../components/ui";

export default function Roster() {
  const { user } = useAuth();
  const [sydekyks, setSydekyks] = useState<Sydekyk[] | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Sydekyk | null>(null);
  const canManage = user?.role === "commander";

  useEffect(() => {
    refresh();
  }, []);

  function refresh() {
    api.get<Sydekyk[]>("/tenant/sydekyks").then((res) => setSydekyks(res.data));
  }

  async function toggleInstall(sydekyk: Sydekyk) {
    if (!canManage || sydekyk.is_exclusive) return;
    setPendingId(sydekyk.id);
    try {
      const res = sydekyk.installed
        ? await api.delete<Sydekyk>(`/tenant/sydekyks/${sydekyk.id}/install`)
        : await api.post<Sydekyk>(`/tenant/sydekyks/${sydekyk.id}/install`);
      const updated = res.data;
      setSydekyks((prev) => prev?.map((s) => (s.id === updated.id ? updated : s)) ?? null);
      setDetail((prev) => (prev && prev.id === updated.id ? updated : prev));
    } finally {
      setPendingId(null);
    }
  }

  return (
    <PageShell>
      <header className="border-b border-ink-700 bg-ink-900/60">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/hq" className="flex items-center gap-2 text-lg font-bold tracking-wide text-gold-300">
            <span className="text-2xl">⚡</span> SYDEKYKS
          </Link>
          <div className="flex items-center gap-4">
            <span className="text-sm text-[#b9ad98]">{user?.email}</span>
            <Link to="/hq">
              <Button variant="ghost">Back to HQ</Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-12">
        <div className="relative overflow-hidden rounded-2xl border border-gold-700/30 bg-gradient-to-br from-ink-800 via-ink-900 to-ink-950 px-8 py-10">
          <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-gold-500/10 blur-3xl" />
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-500">Roster HQ</p>
          <h1 className="mt-2 text-4xl font-bold text-[#f5eee0]">Assemble Your Sydekyks</h1>
          <p className="mt-3 max-w-2xl text-sm text-[#b9ad98]">
            Install shared Sydekyks from the Roster to put them to work for your team, or retire ones you no longer
            need. Exclusive Sydekyks, built just for your HQ, are always standing by.
          </p>
        </div>

        {!sydekyks ? (
          <p className="mt-10 text-sm text-[#b9ad98]">Scanning the Roster…</p>
        ) : sydekyks.length === 0 ? (
          <Card className="mt-10 p-10 text-center text-[#b9ad98]">No Sydekyks available yet.</Card>
        ) : (
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {sydekyks.map((s) => (
              <SydekykCard
                key={s.id}
                sydekyk={s}
                canManage={canManage}
                pending={pendingId === s.id}
                onOpen={() => setDetail(s)}
                onToggleInstall={() => toggleInstall(s)}
              />
            ))}
          </div>
        )}
      </main>

      <Modal open={!!detail} onClose={() => setDetail(null)}>
        {detail && (
          <SydekykDetail
            sydekyk={detail}
            canManage={canManage}
            pending={pendingId === detail.id}
            onClose={() => setDetail(null)}
            onToggleInstall={() => toggleInstall(detail)}
          />
        )}
      </Modal>
    </PageShell>
  );
}

function SydekykCard({
  sydekyk,
  canManage,
  pending,
  onOpen,
  onToggleInstall,
}: {
  sydekyk: Sydekyk;
  canManage: boolean;
  pending: boolean;
  onOpen: () => void;
  onToggleInstall: () => void;
}) {
  return (
    <Card
      onClick={onOpen}
      className="group relative cursor-pointer overflow-hidden transition-transform duration-300 hover:-translate-y-1 hover:border-gold-500/60 hover:shadow-[0_0_30px_-8px_rgba(212,168,40,0.5)]"
    >
      <div className="relative aspect-[912/1199] w-full overflow-hidden bg-ink-950">
        <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_50%_20%,_var(--color-gold-600)_0%,_transparent_65%)] opacity-25 transition-opacity duration-300 group-hover:opacity-40" />
        <img
          src={sydekyk.avatar_url}
          alt={sydekyk.name}
          className="relative z-10 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />

        {/* readability scrim behind the overlaid details */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-3/4 bg-gradient-to-t from-ink-950 via-ink-950/85 to-transparent" />

        <div className="absolute right-3 top-3 z-30">
          <Badge tone={sydekyk.is_exclusive ? "gold" : "neutral"}>
            {sydekyk.is_exclusive ? "Exclusive" : "Roster"}
          </Badge>
        </div>

        <div className="absolute inset-x-0 bottom-0 z-30 p-5">
          <h3 className="text-xl font-bold text-[#f5eee0] [text-shadow:0_2px_10px_rgba(0,0,0,0.8)]">{sydekyk.name}</h3>
          <p className="mt-1 line-clamp-2 text-sm text-[#d8cdb9]">{sydekyk.tagline}</p>

          <div className="mt-3 flex items-center gap-1.5">
            {sydekyk.chat_enabled && <Badge tone="neutral">Chat</Badge>}
            {sydekyk.workflow_enabled && <Badge tone="neutral">Workflow</Badge>}
          </div>

          <div className="mt-4 flex items-center gap-2">
            {sydekyk.is_exclusive ? (
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-gold-400">
                <span className="h-1.5 w-1.5 rounded-full bg-gold-400 shadow-[0_0_8px_2px_rgba(234,194,95,0.7)]" />{" "}
                Always active
              </span>
            ) : sydekyk.installed ? (
              <>
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-gold-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-gold-400 shadow-[0_0_8px_2px_rgba(234,194,95,0.7)]" />{" "}
                  Installed
                </span>
                {canManage && (
                  <Button
                    variant="ghost"
                    className="ml-auto px-3 py-1.5 text-xs backdrop-blur-sm"
                    disabled={pending}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleInstall();
                    }}
                  >
                    {pending ? "…" : "Uninstall"}
                  </Button>
                )}
              </>
            ) : canManage ? (
              <Button
                className="ml-auto px-3 py-1.5 text-xs"
                disabled={pending}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleInstall();
                }}
              >
                {pending ? "Installing…" : "Install"}
              </Button>
            ) : (
              <span className="text-sm text-[#8a7f6d]">Not yet activated</span>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

function SydekykDetail({
  sydekyk,
  canManage,
  pending,
  onClose,
  onToggleInstall,
}: {
  sydekyk: Sydekyk;
  canManage: boolean;
  pending: boolean;
  onClose: () => void;
  onToggleInstall: () => void;
}) {
  return (
    <Card className="relative max-h-[85vh] overflow-y-auto border-gold-600/40 shadow-[0_0_60px_-12px_rgba(212,168,40,0.5)] sm:overflow-hidden">
      <button
        onClick={onClose}
        className="absolute right-4 top-4 z-30 flex h-8 w-8 items-center justify-center rounded-full bg-ink-950/70 text-lg text-[#f5eee0] hover:bg-ink-800"
        aria-label="Close"
      >
        ×
      </button>

      <div className="grid sm:grid-cols-[260px_1fr]">
        <div className="relative aspect-[912/1199] w-full overflow-hidden bg-ink-950 sm:aspect-auto sm:h-full">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_25%,_var(--color-gold-600)_0%,_transparent_70%)] opacity-30" />
          <img
            src={sydekyk.avatar_url}
            alt={sydekyk.name}
            className="relative h-full w-full object-contain object-bottom sm:object-cover sm:object-top"
          />
        </div>

        <div className="flex flex-col p-7">
          <Badge tone={sydekyk.is_exclusive ? "gold" : "neutral"}>
            {sydekyk.is_exclusive ? "Exclusive Sydekyk" : "Roster Sydekyk"}
          </Badge>
          <h2 className="mt-2 text-3xl font-bold text-[#f5eee0]">{sydekyk.name}</h2>
          <p className="mt-3 text-[#d8cdb9]">{sydekyk.description || sydekyk.tagline}</p>

          <div className="mt-6 grid grid-cols-3 gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Model</p>
              <p className="mt-1 text-sm text-[#ede6da]">{sydekyk.model}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Chat mode</p>
              <p className="mt-1 text-sm text-[#ede6da]">{sydekyk.chat_enabled ? "Enabled" : "Off"}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Workflow mode</p>
              <p className="mt-1 text-sm text-[#ede6da]">{sydekyk.workflow_enabled ? "Enabled" : "Off"}</p>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-ink-700 pt-6">
            {sydekyk.is_exclusive ? (
              <span className="text-sm font-semibold text-gold-400">Always active for your HQ</span>
            ) : sydekyk.installed ? (
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-gold-400">
                <span className="h-1.5 w-1.5 rounded-full bg-gold-400 shadow-[0_0_8px_2px_rgba(234,194,95,0.7)]" />{" "}
                Installed for your HQ
              </span>
            ) : (
              <span className="text-sm text-[#8a7f6d]">Not yet activated for your HQ</span>
            )}

            {!sydekyk.is_exclusive && canManage && (
              <Button variant={sydekyk.installed ? "ghost" : "primary"} disabled={pending} onClick={onToggleInstall}>
                {pending ? "Working…" : sydekyk.installed ? "Uninstall" : "Install Sydekyk"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
