import { useEffect, useState, type FormEvent } from "react";
import axios from "axios";
import { api, type Tenant } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Button, Card, Input, Label, PageShell } from "../components/ui";
import { useNavigate } from "react-router-dom";

export default function Admin() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [commanderEmail, setCommanderEmail] = useState("");
  const [commanderPassword, setCommanderPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function loadTenants() {
    setLoading(true);
    const res = await api.get<Tenant[]>("/admin/tenants");
    setTenants(res.data);
    setLoading(false);
  }

  useEffect(() => {
    loadTenants();
  }, []);

  function slugify(value: string) {
    return value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post("/admin/tenants", {
        name,
        slug,
        commander_email: commanderEmail,
        commander_password: commanderPassword,
      });
      setName("");
      setSlug("");
      setCommanderEmail("");
      setCommanderPassword("");
      setShowForm(false);
      await loadTenants();
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.data?.detail) {
        setError(err.response.data.detail);
      } else {
        setError("Failed to create HQ. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleLogout() {
    logout();
    navigate("/login");
  }

  return (
    <PageShell>
      <header className="border-b border-ink-700 bg-ink-900/60">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2 text-lg font-bold tracking-wide text-gold-300">
            <span className="text-2xl">⚡</span> SYDEKYKS <span className="ml-2 rounded border border-gold-700/50 px-2 py-0.5 text-xs font-semibold text-gold-400">Command Center</span>
          </div>
          <Button variant="ghost" onClick={handleLogout}>
            Log out
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#f5eee0]">HQs</h1>
            <p className="mt-1 text-sm text-[#b9ad98]">Every tenant activated on Sydekyks.</p>
          </div>
          <Button onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancel" : "+ Add HQ"}</Button>
        </div>

        {showForm && (
          <Card className="mt-6 p-6">
            <h2 className="text-lg font-semibold text-[#f5eee0]">Activate a new HQ</h2>
            <form onSubmit={handleSubmit} className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <Label>HQ Name</Label>
                <Input
                  required
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (!slug || slug === slugify(name)) setSlug(slugify(e.target.value));
                  }}
                  placeholder="Acme Corp"
                />
              </div>
              <div>
                <Label>Slug</Label>
                <Input required value={slug} onChange={(e) => setSlug(slugify(e.target.value))} placeholder="acme-corp" />
              </div>
              <div>
                <Label>Commander Email</Label>
                <Input
                  type="email"
                  required
                  value={commanderEmail}
                  onChange={(e) => setCommanderEmail(e.target.value)}
                  placeholder="commander@acme.com"
                />
              </div>
              <div>
                <Label>Commander Password</Label>
                <Input
                  type="password"
                  required
                  minLength={8}
                  value={commanderPassword}
                  onChange={(e) => setCommanderPassword(e.target.value)}
                  placeholder="Min. 8 characters"
                />
              </div>
              {error && <p className="md:col-span-2 text-sm text-red-400">{error}</p>}
              <div className="md:col-span-2">
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Activating…" : "Activate HQ"}
                </Button>
              </div>
            </form>
          </Card>
        )}

        <Card className="mt-6 overflow-hidden">
          {loading ? (
            <p className="p-6 text-sm text-[#b9ad98]">Loading HQs…</p>
          ) : tenants.length === 0 ? (
            <p className="p-6 text-sm text-[#b9ad98]">No HQs yet. Activate the first one above.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-ink-700 text-xs uppercase tracking-wider text-gold-500">
                  <th className="px-6 py-3 font-semibold">Name</th>
                  <th className="px-6 py-3 font-semibold">Slug</th>
                  <th className="px-6 py-3 font-semibold">Plan</th>
                  <th className="px-6 py-3 font-semibold">Created</th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((t) => (
                  <tr key={t.id} className="border-b border-ink-700/60 last:border-0">
                    <td className="px-6 py-3 font-medium text-[#f5eee0]">{t.name}</td>
                    <td className="px-6 py-3 text-[#b9ad98]">{t.slug}</td>
                    <td className="px-6 py-3 capitalize text-[#b9ad98]">{t.plan}</td>
                    <td className="px-6 py-3 text-[#b9ad98]">{new Date(t.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </main>
    </PageShell>
  );
}
