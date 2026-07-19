import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { api, type TeamUser } from "../lib/api";
import { HQShell } from "../components/HQShell";
import { Badge, Button, Card, Input, Label } from "../components/ui";

const ROLE_LABEL: Record<string, string> = { commander: "Commander", hero: "Hero" };

export default function Team() {
  const [users, setUsers] = useState<TeamUser[] | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [resetTarget, setResetTarget] = useState<TeamUser | null>(null);
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
      <div className="hq-command-background min-h-screen">
      <main className="relative mx-auto max-w-5xl px-6 py-10">
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
                          <Link to={`/hq/team/${u.id}`}>
                            <Button variant="ghost" className="px-3 py-1.5 text-xs">
                              Manage Access
                            </Button>
                          </Link>
                        ) : (
                          <span className="px-3 py-1.5 text-xs text-[#8a7f6d]">Full access</span>
                        )}
                        {!u.is_self && (
                          <Button
                            variant="ghost"
                            className="px-3 py-1.5 text-xs"
                            onClick={() => setResetTarget(u)}
                          >
                            Reset password
                          </Button>
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
      </div>
      {resetTarget && (
        <ResetPasswordModal user={resetTarget} onClose={() => setResetTarget(null)} />
      )}
    </HQShell>
  );
}

function ResetPasswordModal({ user, onClose }: { user: TeamUser; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post(`/tenant/team/users/${user.id}/reset-password`, { password });
      setDone(true);
    } catch (err) {
      setError(
        axios.isAxiosError(err) ? err.response?.data?.detail ?? "Failed to reset password" : "Failed to reset password",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <Card className="w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-[#f5eee0]">Reset password</h2>
        <p className="mt-1 text-xs text-[#8a7f6d]">
          Set a new password for <span className="text-[#ede6da]">{user.email}</span> and share it with them. They can
          change it themselves later from Settings.
        </p>
        {done ? (
          <div className="mt-5">
            <p className="text-sm font-semibold text-gold-400">Password updated. Share the new password with them.</p>
            <div className="mt-4 flex justify-end">
              <Button type="button" onClick={onClose}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-4 grid gap-4">
            <div>
              <Label>New password</Label>
              <Input
                type="text"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min. 8 characters"
              />
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <div className="flex justify-end gap-3">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Saving…" : "Set Password"}
              </Button>
            </div>
          </form>
        )}
      </Card>
    </div>
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
            <option value="hero">Hero - scoped to granted Sydekyks</option>
            <option value="commander">Commander - full HQ access</option>
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
