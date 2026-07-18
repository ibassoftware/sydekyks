import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type SydekykPermission, type TeamUser } from "../lib/api";
import { HQShell } from "../components/HQShell";
import { Badge, Button, Card, Input } from "../components/ui";

export default function TeamMemberAccess() {
  const { userId } = useParams<{ userId: string }>();
  const [member, setMember] = useState<TeamUser | null>(null);
  const [perms, setPerms] = useState<SydekykPermission[] | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    api.get<TeamUser>(`/tenant/team/users/${userId}`).then((r) => setMember(r.data)).catch(() => setError("User not found"));
    api.get<SydekykPermission[]>(`/tenant/team/users/${userId}/permissions`).then((r) => setPerms(r.data));
  }, [userId]);

  const filtered = useMemo(() => {
    if (!perms) return null;
    const q = query.trim().toLowerCase();
    return q ? perms.filter((p) => p.sydekyk_name.toLowerCase().includes(q)) : perms;
  }, [perms, query]);

  async function setPerm(p: SydekykPermission, next: { can_use: boolean; can_configure: boolean }) {
    if (!userId) return;
    setSavingId(p.sydekyk_id);
    try {
      const res = await api.put<SydekykPermission>(`/tenant/team/users/${userId}/permissions/${p.sydekyk_id}`, next);
      setPerms((prev) => prev?.map((x) => (x.sydekyk_id === res.data.sydekyk_id ? res.data : x)) ?? null);
    } finally {
      setSavingId(null);
    }
  }

  const grantedCount = perms?.filter((p) => p.can_use).length ?? 0;

  return (
    <HQShell>
      <div className="hq-command-background min-h-screen">
      <main className="relative mx-auto max-w-4xl px-6 py-10">
        <Link to="/hq/team" className="text-xs font-semibold text-gold-400 hover:text-gold-300">
          ← Back to Team
        </Link>

        <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-gold-500">Manage Access</p>
            <h1 className="mt-1 text-3xl font-bold text-[#f5eee0]">{member?.email ?? "…"}</h1>
            <p className="mt-1 text-sm text-[#8a7f6d]">
              <span className="font-semibold text-[#b9ad98]">Use</span> lets them run a Sydekyk;{" "}
              <span className="font-semibold text-[#b9ad98]">Configure</span> lets them change its settings. Configure
              implies Use.
            </p>
          </div>
          {perms && <Badge tone="neutral">{grantedCount} of {perms.length} granted</Badge>}
        </div>

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

        <Card className="mt-6 p-5">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search Sydekyks…"
            className="mb-4"
          />

          {!filtered ? (
            <p className="text-sm text-[#8a7f6d]">Loading…</p>
          ) : perms && perms.length === 0 ? (
            <p className="text-sm text-[#8a7f6d]">
              This HQ has no active Sydekyks yet. Activate one from the Roster, then grant access here.
            </p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-[#8a7f6d]">No Sydekyks match “{query}”.</p>
          ) : (
            <div className="grid gap-2">
              <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4 px-1 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gold-500">
                <span>Sydekyk</span>
                <span className="w-16 text-center">Use</span>
                <span className="w-16 text-center">Configure</span>
              </div>
              {filtered.map((p) => (
                <div key={p.sydekyk_id} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 rounded-lg bg-ink-800/40 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-[#ede6da]">{p.sydekyk_name}</span>
                    {p.is_exclusive && <Badge tone="gold">Exclusive</Badge>}
                  </div>
                  <label className="flex w-16 justify-center">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-gold-500"
                      disabled={savingId === p.sydekyk_id}
                      checked={p.can_use}
                      onChange={(e) => setPerm(p, { can_use: e.target.checked, can_configure: e.target.checked ? p.can_configure : false })}
                    />
                  </label>
                  <label className="flex w-16 justify-center">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-gold-500"
                      disabled={savingId === p.sydekyk_id}
                      checked={p.can_configure}
                      onChange={(e) => setPerm(p, { can_use: p.can_use || e.target.checked, can_configure: e.target.checked })}
                    />
                  </label>
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="mt-6">
          <Link to="/hq/team">
            <Button>Done</Button>
          </Link>
        </div>
      </main>
      </div>
    </HQShell>
  );
}
