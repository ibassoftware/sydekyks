import { useEffect, useState, type FormEvent } from "react";
import axios from "axios";
import { api, type SydekykPermission, type TeamUser } from "../lib/api";
import { HQShell } from "../components/HQShell";
import { Badge, Button, Card, Input, Label, Modal } from "../components/ui";

const ROLE_LABEL: Record<string, string> = { commander: "Commander", hero: "Hero" };

export default function Team() {
  const [users, setUsers] = useState<TeamUser[] | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [managing, setManaging] = useState<TeamUser | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await api.get<TeamUser[]>("/tenant/team/users");
    setUsers(res.data);
  }

  useEffect(() => {
    load();
  }, []);

  async function updateRole(u: TeamUser, role: string) {
    setError(null);
    try {
      const res = await api.patch<TeamUser>(`/tenant/team/users/${u.id}`, { role });
      setUsers((prev) => prev?.map((x) => (x.id === res.data.id ? res.data : x)) ?? null);
    } catch (err) {
      setError(axios.isAxiosError(err) ? err.response?.data?.detail ?? "Failed to update role" : "Failed to update role");
    }
  }

  async function removeUser(u: TeamUser) {
    setError(null);
    setRemoving(u.id);
    try {
      await api.delete(`/tenant/team/users/${u.id}`);
      setUsers((prev) => prev?.filter((x) => x.id !== u.id) ?? null);
    } catch (err) {
      setError(axios.isAxiosError(err) ? err.response?.data?.detail ?? "Failed to remove user" : "Failed to remove user");
    } finally {
      setRemoving(null);
    }
  }

  return (
    <HQShell>
      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-gold-500">Team</p>
            <h1 className="mt-1 text-3xl font-bold text-[#f5eee0]">Users &amp; Access</h1>
            <p className="mt-1 text-sm text-[#8a7f6d]">
              Add teammates and choose which Sydekyks each Hero can use and configure. Commanders have full access.
            </p>
          </div>
          <Button onClick={() => setShowAdd((v) => !v)}>{showAdd ? "Cancel" : "+ Add User"}</Button>
        </div>

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

        {showAdd && (
          <AddUserForm
            onCancel={() => setShowAdd(false)}
            onCreated={(u) => {
              setUsers((prev) => [...(prev ?? []), u]);
              setShowAdd(false);
            }}
          />
        )}

        <Card className="mt-6 overflow-hidden">
          {!users ? (
            <p className="p-6 text-sm text-[#b9ad98]">Loading team…</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-ink-700 text-xs uppercase tracking-wider text-gold-500">
                  <th className="px-6 py-3 font-semibold">User</th>
                  <th className="px-6 py-3 font-semibold">Role</th>
                  <th className="px-6 py-3 font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-ink-700/60 last:border-0">
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-[#f5eee0]">{u.email}</span>
                        {u.is_self && <Badge tone="neutral">you</Badge>}
                      </div>
                    </td>
                    <td className="px-6 py-3">
                      {u.is_self ? (
                        <span className="text-[#ede6da]">{ROLE_LABEL[u.role] ?? u.role}</span>
                      ) : (
                        <select
                          className="rounded-md border border-ink-600 bg-ink-900 px-2.5 py-1.5 text-sm text-[#ede6da] outline-none focus:border-gold-500"
                          value={u.role}
                          onChange={(e) => updateRole(u, e.target.value)}
                        >
                          <option value="hero">Hero</option>
                          <option value="commander">Commander</option>
                        </select>
                      )}
                    </td>
                    <td className="px-6 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        {u.role === "hero" ? (
                          <Button variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => setManaging(u)}>
                            Manage Access
                          </Button>
                        ) : (
                          <span className="px-3 py-1.5 text-xs text-[#8a7f6d]">Full access</span>
                        )}
                        {!u.is_self && (
                          <Button
                            variant="ghost"
                            className="px-3 py-1.5 text-xs text-red-400/80 hover:text-red-400"
                            disabled={removing === u.id}
                            onClick={() => removeUser(u)}
                          >
                            {removing === u.id ? "…" : "Remove"}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </main>

      <Modal open={!!managing} onClose={() => setManaging(null)}>
        {managing && <PermissionsModal user={managing} onClose={() => setManaging(null)} />}
      </Modal>
    </HQShell>
  );
}

function AddUserForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (u: TeamUser) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("hero");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.post<TeamUser>("/tenant/team/users", { email, password, role });
      onCreated(res.data);
    } catch (err) {
      setError(axios.isAxiosError(err) ? err.response?.data?.detail ?? "Failed to add user" : "Failed to add user");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="mt-6 p-6">
      <h2 className="text-lg font-semibold text-[#f5eee0]">Add a user</h2>
      <p className="mt-1 text-xs text-[#8a7f6d]">
        You set their initial password and share it with them. Heroes start with no Sydekyk access until you grant it.
      </p>
      <form onSubmit={handleSubmit} className="mt-4 grid gap-4 md:grid-cols-3">
        <div>
          <Label>Email</Label>
          <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@company.com" />
        </div>
        <div>
          <Label>Initial password</Label>
          <Input type="text" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min. 8 characters" />
        </div>
        <div>
          <Label>Role</Label>
          <select
            className="w-full rounded-md border border-ink-600 bg-ink-900 px-3.5 py-2.5 text-sm text-[#ede6da] outline-none focus:border-gold-500"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            <option value="hero">Hero — scoped to granted Sydekyks</option>
            <option value="commander">Commander — full HQ access</option>
          </select>
        </div>
        {error && <p className="md:col-span-3 text-sm text-red-400">{error}</p>}
        <div className="md:col-span-3 flex justify-end gap-3">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Adding…" : "Add User"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function PermissionsModal({ user, onClose }: { user: TeamUser; onClose: () => void }) {
  const [perms, setPerms] = useState<SydekykPermission[] | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    api.get<SydekykPermission[]>(`/tenant/team/users/${user.id}/permissions`).then((r) => setPerms(r.data));
  }, [user.id]);

  async function setPerm(p: SydekykPermission, next: { can_use: boolean; can_configure: boolean }) {
    setSavingId(p.sydekyk_id);
    try {
      const res = await api.put<SydekykPermission>(`/tenant/team/users/${user.id}/permissions/${p.sydekyk_id}`, next);
      setPerms((prev) => prev?.map((x) => (x.sydekyk_id === res.data.sydekyk_id ? res.data : x)) ?? null);
    } finally {
      setSavingId(null);
    }
  }

  return (
    <Card className="border-gold-600/40 p-7 shadow-[0_0_60px_-12px_rgba(212,168,40,0.5)]">
      <h2 className="text-xl font-bold text-[#f5eee0]">Access — {user.email}</h2>
      <p className="mt-1 text-sm text-[#8a7f6d]">
        <span className="font-semibold text-[#b9ad98]">Use</span> lets them run the Sydekyk;{" "}
        <span className="font-semibold text-[#b9ad98]">Configure</span> lets them change its settings. Configure implies
        Use.
      </p>

      {!perms ? (
        <p className="mt-5 text-sm text-[#8a7f6d]">Loading…</p>
      ) : perms.length === 0 ? (
        <p className="mt-5 text-sm text-[#8a7f6d]">
          This HQ has no active Sydekyks yet. Activate one from the Roster, then grant access here.
        </p>
      ) : (
        <div className="mt-5 grid gap-2">
          <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4 px-1 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gold-500">
            <span>Sydekyk</span>
            <span className="w-16 text-center">Use</span>
            <span className="w-16 text-center">Configure</span>
          </div>
          {perms.map((p) => (
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

      <div className="mt-6 flex justify-end">
        <Button onClick={onClose}>Done</Button>
      </div>
    </Card>
  );
}
