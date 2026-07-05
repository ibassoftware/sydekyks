import { useEffect, useState, type FormEvent } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import { api, type BYOKProvider, type ProviderCredential } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Badge, Button, Card, Input, Label, Modal, PageShell } from "../components/ui";

const PROVIDER_INFO: Record<BYOKProvider, { name: string; description: string }> = {
  openai: {
    name: "OpenAI",
    description: "Bring your own OpenAI API key so your Sydekyks can use your account's models.",
  },
  anthropic: {
    name: "Anthropic",
    description: "Bring your own Anthropic API key so your Sydekyks can use Claude models.",
  },
  ollama_cloud: {
    name: "Ollama Cloud",
    description: "Connect your Ollama Cloud instance with a URL and API key.",
  },
};

const PROVIDER_ORDER: BYOKProvider[] = ["openai", "anthropic", "ollama_cloud"];

export default function Settings() {
  const { user } = useAuth();
  const [credentials, setCredentials] = useState<ProviderCredential[] | null>(null);
  const [editingProvider, setEditingProvider] = useState<BYOKProvider | null>(null);
  const [removingProvider, setRemovingProvider] = useState<string | null>(null);

  useEffect(() => {
    refresh();
  }, []);

  function refresh() {
    api.get<ProviderCredential[]>("/tenant/provider-credentials").then((res) => setCredentials(res.data));
  }

  function handleSaved(updated: ProviderCredential) {
    setCredentials((prev) => prev?.map((c) => (c.provider === updated.provider ? updated : c)) ?? null);
    setEditingProvider(null);
  }

  async function handleRemove(provider: BYOKProvider) {
    setRemovingProvider(provider);
    try {
      await api.delete(`/tenant/provider-credentials/${provider}`);
      setCredentials(
        (prev) => prev?.map((c) => (c.provider === provider ? { ...c, has_api_key: false, api_base: null } : c)) ?? null
      );
    } finally {
      setRemovingProvider(null);
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
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-500">AI Providers</p>
          <h1 className="mt-2 text-4xl font-bold text-[#f5eee0]">Settings</h1>
          <p className="mt-3 max-w-2xl text-sm text-[#b9ad98]">
            Connect your own OpenAI, Anthropic, or Ollama Cloud keys here. Once connected, you can assign any of
            these — or Sydekyks' own Power Core — to each Sydekyk individually from the Roster.
          </p>
        </div>

        <section className="mt-10">
          <h2 className="text-lg font-bold text-[#f5eee0]">Connected Providers</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {!credentials ? (
              <p className="text-sm text-[#b9ad98]">Loading…</p>
            ) : (
              PROVIDER_ORDER.map((provider) => {
                const info = PROVIDER_INFO[provider];
                const cred = credentials.find((c) => c.provider === provider);
                const connected = !!cred?.has_api_key;
                return (
                  <Card key={provider} className="flex flex-col p-6">
                    <div className="flex items-center justify-between">
                      <h3 className="text-base font-bold text-[#f5eee0]">{info.name}</h3>
                      {connected && <Badge tone="gold">Connected</Badge>}
                    </div>
                    <p className="mt-3 flex-1 text-sm text-[#8a7f6d]">{info.description}</p>
                    <div className="mt-5 flex gap-2">
                      <Button
                        variant={connected ? "ghost" : "primary"}
                        className="px-4 py-2 text-xs"
                        onClick={() => setEditingProvider(provider)}
                      >
                        {connected ? "Edit" : "Connect"}
                      </Button>
                      {connected && (
                        <Button
                          variant="ghost"
                          className="px-4 py-2 text-xs"
                          disabled={removingProvider === provider}
                          onClick={() => handleRemove(provider)}
                        >
                          {removingProvider === provider ? "…" : "Remove"}
                        </Button>
                      )}
                    </div>
                  </Card>
                );
              })
            )}
          </div>
        </section>
      </main>

      <Modal open={!!editingProvider} onClose={() => setEditingProvider(null)}>
        {editingProvider && (
          <CredentialForm
            provider={editingProvider}
            existing={credentials?.find((c) => c.provider === editingProvider) ?? null}
            onCancel={() => setEditingProvider(null)}
            onSaved={handleSaved}
          />
        )}
      </Modal>
    </PageShell>
  );
}

function CredentialForm({
  provider,
  existing,
  onCancel,
  onSaved,
}: {
  provider: BYOKProvider;
  existing: ProviderCredential | null;
  onCancel: () => void;
  onSaved: (cred: ProviderCredential) => void;
}) {
  const info = PROVIDER_INFO[provider];
  const [apiKey, setApiKey] = useState("");
  const [apiBase, setApiBase] = useState(existing?.api_base ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.put<ProviderCredential>(`/tenant/provider-credentials/${provider}`, {
        api_key: apiKey,
        api_base: provider === "ollama_cloud" ? apiBase : undefined,
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
      <h2 className="text-xl font-bold text-[#f5eee0]">Connect {info.name}</h2>
      <p className="mt-1 text-sm text-[#8a7f6d]">{info.description}</p>

      <form onSubmit={handleSubmit} className="mt-5 grid gap-4">
        {provider === "ollama_cloud" && (
          <div>
            <Label>Ollama Cloud URL</Label>
            <Input
              required
              type="url"
              value={apiBase}
              onChange={(e) => setApiBase(e.target.value)}
              placeholder="https://ollama.com"
            />
          </div>
        )}
        <div>
          <Label>API Key</Label>
          <Input
            required
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={existing?.has_api_key ? "Enter a new key to replace the existing one" : "••••••••"}
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
