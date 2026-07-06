import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Sydekyk } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useActivity } from "../lib/activity";
import { Badge, Button, Card } from "../components/ui";
import { HQShell } from "../components/HQShell";

export default function Roster() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { activeSydekykIds } = useActivity();
  const [sydekyks, setSydekyks] = useState<Sydekyk[] | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const canManage = user?.role === "commander";

  useEffect(() => {
    api.get<Sydekyk[]>("/tenant/sydekyks").then((res) => setSydekyks(res.data));
  }, []);

  async function toggleInstall(sydekyk: Sydekyk) {
    if (!canManage || sydekyk.is_exclusive) return;
    setPendingId(sydekyk.id);
    try {
      const res = sydekyk.installed
        ? await api.delete<Sydekyk>(`/tenant/sydekyks/${sydekyk.id}/install`)
        : await api.post<Sydekyk>(`/tenant/sydekyks/${sydekyk.id}/install`);
      const updated = res.data;
      setSydekyks((prev) => prev?.map((s) => (s.id === updated.id ? updated : s)) ?? null);
    } finally {
      setPendingId(null);
    }
  }

  return (
    <HQShell>
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
                working={activeSydekykIds.has(s.id)}
                onOpen={() => navigate(`/hq/roster/${s.id}`)}
                onToggleInstall={() => toggleInstall(s)}
              />
            ))}
          </div>
        )}
      </main>
    </HQShell>
  );
}

function SydekykCard({
  sydekyk,
  canManage,
  pending,
  working,
  onOpen,
  onToggleInstall,
}: {
  sydekyk: Sydekyk;
  canManage: boolean;
  pending: boolean;
  working: boolean;
  onOpen: () => void;
  onToggleInstall: () => void;
}) {
  return (
    <Card
      onClick={onOpen}
      className={`group relative cursor-pointer overflow-hidden transition-transform duration-300 hover:-translate-y-1 hover:border-gold-500/60 hover:shadow-[0_0_30px_-8px_rgba(212,168,40,0.5)] ${
        working ? "border-gold-500/70 shadow-[0_0_30px_-6px_rgba(212,168,40,0.55)]" : ""
      }`}
    >
      {working && (
        <div className="absolute left-3 top-3 z-30 inline-flex items-center gap-1.5 rounded-full border border-gold-500/50 bg-ink-950/70 px-2.5 py-1 text-[11px] font-semibold text-gold-300 backdrop-blur-sm">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gold-400 opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-gold-400" />
          </span>
          Working…
        </div>
      )}
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
