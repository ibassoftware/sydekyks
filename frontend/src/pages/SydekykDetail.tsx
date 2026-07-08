import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import axios from "axios";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  api,
  type IssuesCount,
  type LedgerReadiness,
  type LLMProvider,
  type ProviderCredential,
  type Sydekyk,
  type SydekykLLMConfig,
  type SydekykLLMConfigTestResult,
} from "../lib/api";
import { useAuth } from "../lib/auth";
import { Badge, Button, Card, Input, Label } from "../components/ui";
import { HQShell } from "../components/HQShell";
import { DocumentIntakeSection } from "../components/DocumentIntakeSection";
import { registryForSlug } from "../sydekyks/registry";

const ENGINE_LABEL: Record<LLMProvider, string> = {
  power_core: "Power Core",
  openai: "OpenAI",
  anthropic: "Anthropic",
  ollama_cloud: "Ollama Cloud",
};

export default function SydekykDetail() {
  const { sydekykId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const canManage = user?.role === "commander";
  const [sydekyk, setSydekyk] = useState<Sydekyk | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [pending, setPending] = useState(false);
  const [readiness, setReadiness] = useState<LedgerReadiness | null>(null);
  const [reviewCount, setReviewCount] = useState(0);
  const registryEntry = registryForSlug(sydekyk?.slug);
  // Settings is configured once; Upload Bills + Recent Missions are used constantly — split them
  // into tabs, defaulting to Operations. Only Sydekyks that accept uploads get a tab bar at all.
  const [activeTab, setActiveTab] = useState<"operations" | "settings">("operations");

  useEffect(() => {
    if (!sydekykId) return;
    api
      .get<Sydekyk>(`/tenant/sydekyks/${sydekykId}`)
      .then((res) => setSydekyk(res.data))
      .catch(() => setNotFound(true));
    api
      .get<IssuesCount>("/tenant/issues/count", { params: { sydekyk_id: sydekykId } })
      .then((res) => setReviewCount(res.data.missions_needing_review))
      .catch(() => setReviewCount(0));
  }, [sydekykId]);

  async function toggleInstall() {
    if (!sydekyk || !canManage || sydekyk.is_exclusive) return;
    setPending(true);
    try {
      const res = sydekyk.installed
        ? await api.delete<Sydekyk>(`/tenant/sydekyks/${sydekyk.id}/install`)
        : await api.post<Sydekyk>(`/tenant/sydekyks/${sydekyk.id}/install`);
      setSydekyk(res.data);
    } finally {
      setPending(false);
    }
  }

  const active = sydekyk && (sydekyk.installed || sydekyk.is_exclusive);

  return (
    <HQShell>
      <main className="mx-auto max-w-5xl px-6 py-10">
        <button onClick={() => navigate("/hq/roster")} className="mb-6 text-sm text-gold-400 hover:text-gold-300">
          ← Roster
        </button>

        {notFound ? (
          <Card className="p-10 text-center text-[#b9ad98]">Sydekyk not found.</Card>
        ) : !sydekyk ? (
          <p className="text-sm text-[#b9ad98]">Loading…</p>
        ) : (
          <div className="grid gap-6">
            {/* Hero */}
            <Card className="overflow-hidden">
              <div className="grid gap-6 p-6 sm:grid-cols-[220px_1fr]">
                <div className="relative mx-auto aspect-[912/1199] w-full max-w-[220px] overflow-hidden rounded-xl bg-ink-950">
                  <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_25%,_var(--color-gold-600)_0%,_transparent_70%)] opacity-30" />
                  <img
                    src={sydekyk.avatar_url}
                    alt={sydekyk.name}
                    className="relative h-full w-full object-cover object-top"
                  />
                </div>

                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <Badge tone={sydekyk.is_exclusive ? "gold" : "neutral"}>
                      {sydekyk.is_exclusive ? "Exclusive Sydekyk" : "Roster Sydekyk"}
                    </Badge>
                    {sydekyk.chat_enabled && <Badge tone="neutral">Chat</Badge>}
                    {sydekyk.workflow_enabled && <Badge tone="neutral">Workflow</Badge>}
                  </div>
                  <h1 className="mt-2 text-3xl font-bold text-[#f5eee0]">{sydekyk.name}</h1>
                  <p className="mt-3 flex-1 text-[#d8cdb9]">{sydekyk.description || sydekyk.tagline}</p>

                  <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-ink-700 pt-5">
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
                      <Button
                        variant={sydekyk.installed ? "ghost" : "primary"}
                        disabled={pending}
                        onClick={toggleInstall}
                      >
                        {pending ? "Working…" : sydekyk.installed ? "Uninstall" : "Install Sydekyk"}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </Card>

            {active && reviewCount > 0 && (
              <Link
                to={`/hq/issues?sydekyk_id=${sydekyk.id}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-amber-600/40 bg-amber-500/10 px-5 py-3 transition-colors hover:bg-amber-500/15"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-400">
                    ⚠
                  </span>
                  <p className="text-sm font-semibold text-[#f5eee0]">
                    {reviewCount} {reviewCount === 1 ? "bill needs" : "bills need"} review
                  </p>
                </div>
                <span className="text-xs font-semibold text-amber-400">Review now →</span>
              </Link>
            )}

            {active && sydekyk.accepts_document_uploads ? (
              <>
                <div className="flex gap-1 border-b border-ink-700">
                  {(["operations", "settings"] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`px-4 py-2.5 text-sm font-semibold capitalize transition-colors ${
                        activeTab === tab
                          ? "border-b-2 border-gold-500 text-gold-300"
                          : "text-[#8a7f6d] hover:text-[#b9ad98]"
                      }`}
                    >
                      {tab === "operations" ? "Upload Bills" : "Settings"}
                    </button>
                  ))}
                </div>

                {/* Both tabs stay mounted (CSS-hidden, not unmounted) so the readiness fetch inside
                    Settings keeps running and gates the upload panel even while Operations is open. */}
                <div className={activeTab === "operations" ? "grid gap-6" : "hidden"}>
                  <Card className="p-6">
                    <DocumentIntakeSection sydekyk={sydekyk} canManage={canManage} readiness={readiness} />
                  </Card>
                </div>

                <div className={activeTab === "settings" ? "grid gap-6" : "hidden"}>
                  <Card className="p-6">
                    <AIEngineSection sydekyk={sydekyk} canManage={canManage} />
                  </Card>
                  {registryEntry?.setupSection && (
                    <Card className="p-6">
                      <registryEntry.setupSection sydekyk={sydekyk} canManage={canManage} onReadiness={setReadiness} />
                    </Card>
                  )}
                  {registryEntry?.playbookPanel && (
                    <Card className="p-6">
                      <registryEntry.playbookPanel />
                    </Card>
                  )}
                </div>
              </>
            ) : active ? (
              <>
                <Card className="p-6">
                  <AIEngineSection sydekyk={sydekyk} canManage={canManage} />
                </Card>
                {registryEntry?.setupSection && (
                  <Card className="p-6">
                    <registryEntry.setupSection sydekyk={sydekyk} canManage={canManage} onReadiness={setReadiness} />
                  </Card>
                )}
                {registryEntry?.playbookPanel && (
                  <Card className="p-6">
                    <registryEntry.playbookPanel />
                  </Card>
                )}
              </>
            ) : (
              <Card className="p-6 text-center text-sm text-[#8a7f6d]">
                Install this Sydekyk to configure its AI engine and put it to work.
              </Card>
            )}
          </div>
        )}
      </main>
    </HQShell>
  );
}

function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">{title}</p>
      {action}
    </div>
  );
}

function EngineStatusBadge({ status }: { status: SydekykLLMConfig["status"] }) {
  if (status === "connected") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-gold-400">
        <span className="h-1.5 w-1.5 rounded-full bg-gold-400 shadow-[0_0_8px_2px_rgba(234,194,95,0.7)]" /> Connected
      </span>
    );
  }
  if (status === "error") {
    return <Badge tone="danger">Connection failed</Badge>;
  }
  return <Badge tone="neutral">Untested</Badge>;
}

function AIEngineSection({ sydekyk, canManage }: { sydekyk: Sydekyk; canManage: boolean }) {
  const [config, setConfig] = useState<SydekykLLMConfig | null>(null);
  const [credentials, setCredentials] = useState<ProviderCredential[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    api.get<SydekykLLMConfig>(`/tenant/sydekyks/${sydekyk.id}/llm-config`).then((res) => setConfig(res.data));
    if (canManage) {
      api.get<ProviderCredential[]>("/tenant/provider-credentials").then((res) => setCredentials(res.data));
    }
  }, [sydekyk.id, canManage]);

  function handleSaved(updated: SydekykLLMConfig) {
    setConfig(updated);
    setEditing(false);
    setTestResult(null);
  }

  async function handleTest() {
    setTesting(true);
    try {
      const res = await api.post<SydekykLLMConfigTestResult>(`/tenant/sydekyks/${sydekyk.id}/llm-config/test`);
      setConfig(res.data.config);
      setTestResult({ ok: res.data.ok, message: res.data.message });
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.data?.detail) {
        setTestResult({ ok: false, message: err.response.data.detail });
      }
    } finally {
      setTesting(false);
    }
  }

  return (
    <div>
      <SectionHeader
        title="AI Engine"
        action={
          canManage && !editing && config ? (
            <Button variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => setEditing(true)}>
              Change Engine
            </Button>
          ) : undefined
        }
      />

      {!config ? (
        <p className="mt-2 text-sm text-[#8a7f6d]">Loading…</p>
      ) : editing ? (
        <EngineForm sydekyk={sydekyk} config={config} credentials={credentials} onCancel={() => setEditing(false)} onSaved={handleSaved} />
      ) : (
        <div className="mt-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-[#ede6da]">{ENGINE_LABEL[config.provider]}</p>
              {config.model && <p className="text-xs text-[#8a7f6d]">{config.model}</p>}
            </div>
            <div className="flex items-center gap-2">
              <EngineStatusBadge status={config.status} />
              {canManage && (
                <Button variant="ghost" className="px-3 py-1.5 text-xs" disabled={testing} onClick={handleTest}>
                  {testing ? "Testing…" : "Test"}
                </Button>
              )}
            </div>
          </div>
          {testResult ? (
            <p className={`mt-2 text-xs ${testResult.ok ? "text-gold-400" : "text-red-400"}`}>{testResult.message}</p>
          ) : (
            config.status === "error" &&
            config.last_test_error && <p className="mt-2 text-xs text-red-400">{config.last_test_error}</p>
          )}
        </div>
      )}
    </div>
  );
}

function EngineForm({
  sydekyk,
  config,
  credentials,
  onCancel,
  onSaved,
}: {
  sydekyk: Sydekyk;
  config: SydekykLLMConfig;
  credentials: ProviderCredential[] | null;
  onCancel: () => void;
  onSaved: (config: SydekykLLMConfig) => void;
}) {
  const [provider, setProvider] = useState<LLMProvider>(config.provider);
  const [model, setModel] = useState(config.model ?? "");
  const [models, setModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const connected = new Set((credentials ?? []).filter((c) => c.has_api_key).map((c) => c.provider));

  useEffect(() => {
    if (provider === "anthropic") {
      api.post<{ models: string[] }>("/tenant/llm-models/anthropic").then((res) => setModels(res.data.models));
    } else {
      setModels([]);
    }
  }, [provider]);

  async function fetchOpenAIModels() {
    setFetchingModels(true);
    setError(null);
    try {
      const res = await api.post<{ ok: boolean; message: string; models: string[] }>("/tenant/llm-models/openai");
      if (res.data.ok) {
        setModels(res.data.models);
      } else {
        setError(res.data.message);
      }
    } finally {
      setFetchingModels(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.put<SydekykLLMConfig>(`/tenant/sydekyks/${sydekyk.id}/llm-config`, {
        provider,
        model: provider === "power_core" ? undefined : model,
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

  const selectClass =
    "w-full rounded-md border border-ink-600 bg-ink-900 px-3.5 py-2.5 text-sm text-[#ede6da] outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500/50";

  return (
    <form onSubmit={handleSubmit} className="mt-3 grid gap-3">
      <div>
        <Label>Engine</Label>
        <select className={selectClass} value={provider} onChange={(e) => setProvider(e.target.value as LLMProvider)}>
          <option value="power_core">Power Core (Sydekyks-hosted)</option>
          <option value="openai" disabled={!connected.has("openai")}>
            OpenAI {!connected.has("openai") && "— connect in Settings"}
          </option>
          <option value="anthropic" disabled={!connected.has("anthropic")}>
            Anthropic {!connected.has("anthropic") && "— connect in Settings"}
          </option>
          <option value="ollama_cloud" disabled={!connected.has("ollama_cloud")}>
            Ollama Cloud {!connected.has("ollama_cloud") && "— connect in Settings"}
          </option>
        </select>
      </div>

      {provider !== "power_core" && (
        <div>
          <Label>Model</Label>
          {provider === "ollama_cloud" ? (
            <Input required value={model} onChange={(e) => setModel(e.target.value)} placeholder="llama3.1" />
          ) : (
            <div className="flex gap-2">
              <select required className={selectClass} value={model} onChange={(e) => setModel(e.target.value)}>
                <option value="" disabled>
                  {models.length === 0 ? "Fetch models to choose one" : "Select a model"}
                </option>
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              {provider === "openai" && (
                <Button
                  type="button"
                  variant="ghost"
                  className="whitespace-nowrap px-3 py-2 text-xs"
                  disabled={fetchingModels}
                  onClick={fetchOpenAIModels}
                >
                  {fetchingModels ? "Fetching…" : "Fetch Models"}
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="mt-1 flex items-center justify-end gap-3">
        <Button type="button" variant="ghost" className="px-4 py-2 text-xs" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" className="px-4 py-2 text-xs" disabled={submitting}>
          {submitting ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}

