import { useEffect, useState, type FormEvent } from "react";
import axios from "axios";
import { api, type HostedAssignment, type ProviderKey, type SydekykAdmin, type SydekykUsage, type Tenant } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Badge, Button, Card, Input, Label, Modal, PageShell } from "../components/ui";
import { useNavigate } from "react-router-dom";

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  ollama_cloud: "Ollama Cloud",
};

export default function Admin() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [sydekyks, setSydekyks] = useState<SydekykAdmin[]>([]);
  const [sydekyksLoading, setSydekyksLoading] = useState(true);
  const [publishPendingId, setPublishPendingId] = useState<string | null>(null);
  const [providerKeys, setProviderKeys] = useState<ProviderKey[] | null>(null);
  const [editingProviderKey, setEditingProviderKey] = useState<ProviderKey | null>(null);
  const [removingProviderKey, setRemovingProviderKey] = useState<string | null>(null);
  const [configuringSydekyk, setConfiguringSydekyk] = useState<SydekykAdmin | null>(null);

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

  async function loadSydekyks() {
    setSydekyksLoading(true);
    const res = await api.get<SydekykAdmin[]>("/admin/sydekyks");
    setSydekyks(res.data);
    setSydekyksLoading(false);
  }

  async function loadProviderKeys() {
    const res = await api.get<ProviderKey[]>("/admin/provider-keys");
    setProviderKeys(res.data);
  }

  async function disableProviderKey(provider: string) {
    setRemovingProviderKey(provider);
    try {
      const res = await api.delete<ProviderKey>(`/admin/provider-keys/${provider}`);
      setProviderKeys((prev) => prev?.map((k) => (k.provider === provider ? res.data : k)) ?? null);
    } finally {
      setRemovingProviderKey(null);
    }
  }

  useEffect(() => {
    loadTenants();
    loadSydekyks();
    loadProviderKeys();
  }, []);

  async function updateRecommendedModel(sydekyk: SydekykAdmin, model: string) {
    const res = await api.patch<SydekykAdmin>(`/admin/sydekyks/${sydekyk.id}/model`, { model });
    setSydekyks((prev) => prev.map((s) => (s.id === res.data.id ? res.data : s)));
  }

  async function togglePublish(sydekyk: SydekykAdmin) {
    setPublishPendingId(sydekyk.id);
    try {
      const res = sydekyk.is_published
        ? await api.delete<SydekykAdmin>(`/admin/sydekyks/${sydekyk.id}/publish`)
        : await api.post<SydekykAdmin>(`/admin/sydekyks/${sydekyk.id}/publish`);
      const updated = res.data;
      setSydekyks((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    } finally {
      setPublishPendingId(null);
    }
  }

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

        <div className="mt-12 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-[#f5eee0]">Roster Sydekyks</h2>
            <p className="mt-1 text-sm text-[#b9ad98]">
              Shared Sydekyks available across every HQ. Publish to make one installable tenant-wide, or unpublish to
              pull it back.
            </p>
          </div>
        </div>

        <Card className="mt-6 overflow-hidden">
          {sydekyksLoading ? (
            <p className="p-6 text-sm text-[#b9ad98]">Loading Roster Sydekyks…</p>
          ) : sydekyks.length === 0 ? (
            <p className="p-6 text-sm text-[#b9ad98]">No Roster Sydekyks yet.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-ink-700 text-xs uppercase tracking-wider text-gold-500">
                  <th className="px-6 py-3 font-semibold">Sydekyk</th>
                  <th className="px-6 py-3 font-semibold">Recommended Model</th>
                  <th className="px-6 py-3 font-semibold">Modes</th>
                  <th className="px-6 py-3 font-semibold">Status</th>
                  <th className="px-6 py-3 font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {sydekyks.map((s) => (
                  <tr key={s.id} className="border-b border-ink-700/60 last:border-0">
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-3">
                        <img
                          src={s.avatar_url}
                          alt={s.name}
                          className="h-9 w-9 rounded-full border border-ink-600 object-cover object-top"
                        />
                        <div>
                          <p className="font-medium text-[#f5eee0]">{s.name}</p>
                          <p className="text-xs text-[#8a7f6d]">{s.tagline}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-3 text-[#b9ad98]">
                      <RecommendedModelCell sydekyk={s} onSave={(model) => updateRecommendedModel(s, model)} />
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex gap-1.5">
                        {s.chat_enabled && <Badge tone="neutral">Chat</Badge>}
                        {s.workflow_enabled && <Badge tone="neutral">Workflow</Badge>}
                      </div>
                    </td>
                    <td className="px-6 py-3">
                      {s.is_published ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-gold-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-gold-400 shadow-[0_0_8px_2px_rgba(234,194,95,0.7)]" />
                          Published
                        </span>
                      ) : (
                        <span className="text-xs font-semibold text-[#8a7f6d]">Draft</span>
                      )}
                    </td>
                    <td className="px-6 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => setConfiguringSydekyk(s)}>
                          Configure Engine
                        </Button>
                        <Button
                          variant="ghost"
                          className="px-3 py-1.5 text-xs"
                          disabled={publishPendingId === s.id}
                          onClick={() => togglePublish(s)}
                        >
                          {publishPendingId === s.id ? "…" : s.is_published ? "Unpublish" : "Publish"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <div className="mt-12">
          <h2 className="text-2xl font-bold text-[#f5eee0]">Central Provider Keys</h2>
          <p className="mt-1 text-sm text-[#b9ad98]">
            API keys Sydekyks holds centrally, used whenever a tenant is on the Sydekyks-hosted provider.
          </p>
        </div>

        <Card className="mt-6 overflow-hidden">
          {!providerKeys ? (
            <p className="p-6 text-sm text-[#b9ad98]">Loading…</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-ink-700 text-xs uppercase tracking-wider text-gold-500">
                  <th className="px-6 py-3 font-semibold">Provider</th>
                  <th className="px-6 py-3 font-semibold">Status</th>
                  <th className="px-6 py-3 font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {providerKeys.map((key) => (
                  <tr key={key.provider} className="border-b border-ink-700/60 last:border-0">
                    <td className="px-6 py-3 font-medium text-[#f5eee0]">{PROVIDER_LABELS[key.provider] ?? key.provider}</td>
                    <td className="px-6 py-3">
                      {key.has_api_key ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-gold-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-gold-400 shadow-[0_0_8px_2px_rgba(234,194,95,0.7)]" />
                          Configured
                        </span>
                      ) : (
                        <span className="text-xs font-semibold text-[#8a7f6d]">Not configured</span>
                      )}
                    </td>
                    <td className="px-6 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => setEditingProviderKey(key)}>
                          Edit
                        </Button>
                        {key.has_api_key && (
                          <Button
                            variant="ghost"
                            className="px-3 py-1.5 text-xs"
                            disabled={removingProviderKey === key.provider}
                            onClick={() => disableProviderKey(key.provider)}
                          >
                            {removingProviderKey === key.provider ? "…" : "Disable"}
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

      <Modal open={!!editingProviderKey} onClose={() => setEditingProviderKey(null)}>
        {editingProviderKey && (
          <ProviderKeyForm
            providerKey={editingProviderKey}
            onCancel={() => setEditingProviderKey(null)}
            onSaved={(updated) => {
              setProviderKeys((prev) => prev?.map((k) => (k.provider === updated.provider ? updated : k)) ?? null);
              setEditingProviderKey(null);
            }}
          />
        )}
      </Modal>

      <Modal open={!!configuringSydekyk} onClose={() => setConfiguringSydekyk(null)}>
        {configuringSydekyk && (
          <HostedAssignmentForm sydekyk={configuringSydekyk} onClose={() => setConfiguringSydekyk(null)} />
        )}
      </Modal>
    </PageShell>
  );
}

function RecommendedModelCell({ sydekyk, onSave }: { sydekyk: SydekykAdmin; onSave: (model: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(sydekyk.model);
  const [saving, setSaving] = useState(false);

  if (!editing) {
    return (
      <button className="text-left hover:text-gold-300" onClick={() => setEditing(true)}>
        {sydekyk.model}
      </button>
    );
  }

  async function save() {
    setSaving(true);
    try {
      await onSave(value);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        className="px-2 py-1.5 text-xs"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={saving}
      />
      <Button className="px-2 py-1.5 text-xs" disabled={saving} onClick={save}>
        {saving ? "…" : "Save"}
      </Button>
      <Button variant="ghost" className="px-2 py-1.5 text-xs" disabled={saving} onClick={() => setEditing(false)}>
        Cancel
      </Button>
    </div>
  );
}

function ProviderKeyForm({
  providerKey,
  onCancel,
  onSaved,
}: {
  providerKey: ProviderKey;
  onCancel: () => void;
  onSaved: (key: ProviderKey) => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [apiBase, setApiBase] = useState(providerKey.api_base ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.put<ProviderKey>(`/admin/provider-keys/${providerKey.provider}`, {
        api_key: apiKey,
        api_base: apiBase || undefined,
      });
      onSaved(res.data);
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.data?.detail) {
        setError(err.response.data.detail);
      } else {
        setError("Failed to save. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="border-gold-600/40 p-7 shadow-[0_0_60px_-12px_rgba(212,168,40,0.5)]">
      <h2 className="text-xl font-bold text-[#f5eee0]">{PROVIDER_LABELS[providerKey.provider] ?? providerKey.provider} Key</h2>
      <form onSubmit={handleSubmit} className="mt-5 grid gap-4">
        {providerKey.provider === "ollama_cloud" && (
          <div>
            <Label>Base URL</Label>
            <Input value={apiBase} onChange={(e) => setApiBase(e.target.value)} placeholder="https://ollama.com" />
          </div>
        )}
        <div>
          <Label>API Key</Label>
          <Input
            required
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={providerKey.has_api_key ? "Enter a new key to replace the existing one" : "••••••••"}
          />
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="mt-2 flex items-center justify-end gap-3">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function HostedAssignmentForm({ sydekyk, onClose }: { sydekyk: SydekykAdmin; onClose: () => void }) {
  const [assignment, setAssignment] = useState<HostedAssignment | null>(null);
  const [usage, setUsage] = useState<SydekykUsage | null>(null);
  const [hostedProvider, setHostedProvider] = useState("openai");
  const [hostedModel, setHostedModel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get<HostedAssignment>(`/admin/sydekyks/${sydekyk.id}/hosted-assignment`).then((res) => {
      setAssignment(res.data);
      if (res.data.hosted_provider) setHostedProvider(res.data.hosted_provider);
      if (res.data.hosted_model) setHostedModel(res.data.hosted_model);
    });
    api.get<SydekykUsage>(`/admin/sydekyks/${sydekyk.id}/usage`).then((res) => setUsage(res.data));
  }, [sydekyk.id]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setSubmitting(true);
    try {
      const res = await api.put<HostedAssignment>(`/admin/sydekyks/${sydekyk.id}/hosted-assignment`, {
        hosted_provider: hostedProvider,
        hosted_model: hostedModel,
      });
      setAssignment(res.data);
      setSaved(true);
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.data?.detail) {
        setError(err.response.data.detail);
      } else {
        setError("Failed to save. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="border-gold-600/40 p-7 shadow-[0_0_60px_-12px_rgba(212,168,40,0.5)]">
      <h2 className="text-xl font-bold text-[#f5eee0]">Configure Engine — {sydekyk.name}</h2>
      <p className="mt-1 text-sm text-[#8a7f6d]">
        The real provider/model used whenever any tenant assigns Power Core to {sydekyk.name}. Hidden from tenants,
        shared across every tenant that uses it.
      </p>

      {usage && (
        <p className="mt-4 text-sm text-[#ede6da]">
          Total Power Core spend across all HQs: ${usage.spend_used.toFixed(2)}
          {usage.stale && <span className="text-xs text-[#8a7f6d]"> (last known value)</span>}
        </p>
      )}

      {!assignment ? (
        <p className="mt-4 text-sm text-[#8a7f6d]">Loading…</p>
      ) : (
        <form onSubmit={handleSubmit} className="mt-5 grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Provider</Label>
              <select
                className="w-full rounded-md border border-ink-600 bg-ink-900 px-3.5 py-2.5 text-sm text-[#ede6da] outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500/50"
                value={hostedProvider}
                onChange={(e) => {
                  setHostedProvider(e.target.value);
                  setSaved(false);
                }}
              >
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="ollama_cloud">Ollama Cloud</option>
              </select>
            </div>
            <div>
              <Label>Model</Label>
              <Input
                required
                value={hostedModel}
                onChange={(e) => {
                  setHostedModel(e.target.value);
                  setSaved(false);
                }}
                placeholder="gpt-4o-mini"
              />
            </div>
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}
          {saved && !error && (
            <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-gold-400">
              <span className="h-1.5 w-1.5 rounded-full bg-gold-400 shadow-[0_0_8px_2px_rgba(234,194,95,0.7)]" /> Saved —{" "}
              {sydekyk.name} will use this engine going forward.
            </p>
          )}

          <div className="mt-2 flex items-center justify-end gap-3">
            <Button type="button" variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving…" : "Save Assignment"}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
