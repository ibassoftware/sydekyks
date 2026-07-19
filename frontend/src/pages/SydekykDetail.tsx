import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import axios from "axios";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
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
import { ConfirmUninstallModal } from "../components/ConfirmUninstallModal";
import { HQShell } from "../components/HQShell";
import { DocumentIntakeSection } from "../components/DocumentIntakeSection";
import { ReviewerAssignment } from "../components/ReviewerAssignment";
import { TypeUIPanel } from "../components/TypeUIPanel";
import { BoltIcon, GearIcon } from "../components/icons";
import { registryForSlug } from "../sydekyks/registry";
import { SettingsBand } from "../sydekyks/SettingsLayout";

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
  const [searchParams, setSearchParams] = useSearchParams();
  const isCommander = user?.role === "commander";
  const [sydekyk, setSydekyk] = useState<Sydekyk | null>(null);
  // Per-Sydekyk permissions (a commander has both). Run-actions gate on canUse; settings/engine on
  // canConfigure - mirrors the backend's assert_can_use / assert_can_configure so use-only heroes
  // can actually operate an agent they're granted, without seeing (blocked) config controls.
  const canUse = sydekyk?.can_use ?? isCommander;
  const canConfigure = sydekyk?.can_configure ?? isCommander;
  const [notFound, setNotFound] = useState(false);
  const [pending, setPending] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [readiness, setReadiness] = useState<LedgerReadiness | null>(null);
  const [reviewCount, setReviewCount] = useState(0);
  const registryEntry = registryForSlug(sydekyk?.slug);
  // Every agent uses the same workspace contract: day-to-day work lives under Actions; privileged
  // setup lives under Settings. This keeps use-only Heroes away from configuration reads as well as
  // writes, while Commanders and configure-enabled Heroes can access both surfaces.
  const [activeTab, setActiveTab] = useState<"actions" | "settings">(
    searchParams.get("tab") === "settings" ? "settings" : "actions",
  );

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

  useEffect(() => {
    if (!sydekyk?.accepts_document_uploads || !canUse) return;
    let current = true;
    api.get<LedgerReadiness>(`/tenant/${sydekyk.slug}/readiness`)
      .then((response) => {
        if (current) setReadiness(response.data);
      })
      .catch(() => {
        if (current) setReadiness(null);
      });
    return () => { current = false; };
  }, [canUse, sydekyk?.accepts_document_uploads, sydekyk?.slug]);

  useEffect(() => {
    if (!sydekyk || canConfigure || activeTab !== "settings") return;
    setActiveTab("actions");
    const next = new URLSearchParams(searchParams);
    next.delete("tab");
    setSearchParams(next, { replace: true });
  }, [activeTab, canConfigure, searchParams, setSearchParams, sydekyk]);

  function selectTab(tab: "actions" | "settings") {
    if (tab === "settings" && !canConfigure) return;
    setActiveTab(tab);
    const next = new URLSearchParams(searchParams);
    if (tab === "settings") next.set("tab", "settings");
    else next.delete("tab");
    setSearchParams(next, { replace: true });
  }

  async function toggleInstall() {
    if (!sydekyk || !isCommander || sydekyk.is_exclusive) return;
    // Uninstall wipes this HQ's config for the Sydekyk — confirm via dialog before deleting.
    if (sydekyk.installed) {
      setConfirmRemove(true);
      return;
    }
    setPending(true);
    try {
      const res = await api.post<Sydekyk>(`/tenant/sydekyks/${sydekyk.id}/install`);
      setSydekyk(res.data);
    } finally {
      setPending(false);
    }
  }

  async function confirmUninstall() {
    if (!sydekyk) return;
    setPending(true);
    try {
      const res = await api.delete<Sydekyk>(`/tenant/sydekyks/${sydekyk.id}/install`);
      setSydekyk(res.data);
      setConfirmRemove(false);
    } finally {
      setPending(false);
    }
  }

  const active = sydekyk && (sydekyk.installed || sydekyk.is_exclusive);

  return (
    <HQShell>
      <main id="main-content" className="typeui-page mx-auto max-w-5xl px-6 py-12">
        <button onClick={() => navigate("/hq/roster")} className="mb-8 inline-flex min-h-11 items-center text-sm font-medium text-gold-300 hover:text-heading">
          ← Back to roster
        </button>

        {notFound ? (
          <Card className="p-10 text-center text-body">Sydekyk not found.</Card>
        ) : !sydekyk ? (
          <p className="text-sm text-body">Loading…</p>
        ) : (
          <div className="grid gap-6">
            {/* Hero */}
            <Card className="overflow-hidden shadow-[var(--shadow-md)]">
              <div className="grid gap-8 p-6 md:grid-cols-[240px_1fr] md:p-8">
                <div className="relative mx-auto aspect-[912/1199] w-full max-w-[240px] overflow-hidden rounded-[4px] border-2 border-ink-600 bg-ink-950">
                  <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_25%,_var(--color-gold-600)_0%,_transparent_70%)] opacity-30" />
                  <img
                    src={sydekyk.avatar_url}
                    alt={sydekyk.name}
                    className="relative h-full w-full object-contain object-bottom"
                  />
                </div>

                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <Badge tone={sydekyk.is_exclusive ? "gold" : "neutral"}>
                      {sydekyk.is_exclusive ? "Exclusive Sydekyk" : "Roster Sydekyk"}
                    </Badge>
                    {sydekyk.chat_enabled && <Badge tone="neutral">Chat</Badge>}
                    {sydekyk.workflow_enabled && <Badge tone="neutral">Workflow</Badge>}
                    {active && (
                      <Badge tone={canConfigure ? "gold" : "neutral"}>
                        {canConfigure ? "Use + configure" : canUse ? "Use access" : "No access"}
                      </Badge>
                    )}
                  </div>
                  <h1 className="mt-6">{sydekyk.name}</h1>
                  <p className="mt-8 max-w-[65ch] flex-1 text-lg text-body">{sydekyk.description || sydekyk.tagline}</p>

                  <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t-2 border-ink-600 pt-6">
                    {sydekyk.is_exclusive ? (
                      <span className="text-sm font-semibold text-gold-400">Always active for your HQ</span>
                    ) : sydekyk.installed ? (
                      <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-gold-400">
                        <span className="h-2 w-2 rounded-full bg-gold-400 shadow-[var(--shadow-sm)]" />{" "}
                        Installed for your HQ
                      </span>
                    ) : (
                      <span className="text-sm text-body">Not yet activated for your HQ</span>
                    )}

                    {!sydekyk.is_exclusive && isCommander && (
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
                to={`/hq/missions?view=attention&sydekyk_id=${sydekyk.id}`}
                className="fx-lift flex items-center justify-between gap-3 rounded-[4px] border-2 border-amber-600/40 bg-amber-500/10 px-5 py-4 hover:bg-amber-500/15"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-400">
                    ⚠
                  </span>
                  <p className="text-sm font-semibold text-heading">
                    {reviewCount}{" "}
                    {reviewCount === 1
                      ? `${registryEntry?.reviewNoun?.one ?? "item"} needs`
                      : `${registryEntry?.reviewNoun?.many ?? "items"} need`}{" "}
                    review
                  </p>
                </div>
                <span className="text-xs font-semibold text-amber-400">Review now →</span>
              </Link>
            )}

            {active ? (
              <>
                <div role="tablist" aria-label={`${sydekyk.name} workspace`} className="flex border-b-2 border-ink-600">
                  {(["actions", "settings"] as const).map((tab) => {
                    const restricted = tab === "settings" && !canConfigure;
                    const Icon = tab === "actions" ? BoltIcon : GearIcon;
                    return (
                    <button
                      key={tab}
                      role="tab"
                      aria-selected={activeTab === tab}
                      aria-disabled={restricted}
                      disabled={restricted}
                      title={restricted ? "Configure access is required" : undefined}
                      onClick={() => selectTab(tab)}
                      className={`inline-flex min-h-11 items-center gap-2 rounded-t-[4px] border-b-[3px] px-4 py-3 text-base font-medium transition-colors disabled:cursor-not-allowed disabled:text-body/60 ${
                        activeTab === tab
                          ? "border-gold-500 text-gold-300"
                          : "border-transparent text-body hover:border-ink-600 hover:text-heading"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      {tab === "actions" ? "Actions" : "Settings"}
                      {restricted && <span className="text-xs font-normal">Configure access required</span>}
                    </button>
                    );
                  })}
                </div>

                {activeTab === "actions" ? (
                  <div role="tabpanel" className="grid gap-6">
                    {!canUse ? (
                      <Card className="p-6">
                        <p className="text-base font-medium text-heading">This command post is outside your current assignment.</p>
                        <p className="mt-3 text-sm text-body">Ask a Commander to grant Use access for {sydekyk.name}.</p>
                      </Card>
                    ) : sydekyk.accepts_document_uploads ? (
                      <Card className="p-6">
                        <DocumentIntakeSection sydekyk={sydekyk} canManage={canUse} readiness={readiness} uploadContext={registryEntry?.uploadContext} />
                      </Card>
                    ) : registryEntry?.operationsPanel ? (
                      <Card className="p-6">
                        <registryEntry.operationsPanel sydekyk={sydekyk} canManage={canUse} />
                      </Card>
                    ) : (
                      <Card className="p-6 text-sm text-body">No direct actions are available for this agent yet.</Card>
                    )}
                  </div>
                ) : canConfigure ? (
                  <Card role="tabpanel" className="overflow-hidden">
                    <div className="settings-console divide-y-2 divide-ink-600">
                      <SettingsBand id="ai-engine" title="AI engine" description="Choose and verify the model that powers this agent's judgment and writing.">
                        <AIEngineSection sydekyk={sydekyk} canManage />
                      </SettingsBand>
                      {registryEntry?.setupSection && (
                        registryEntry.setupSectionOwnsLayout ? (
                          <registryEntry.setupSection sydekyk={sydekyk} canManage onReadiness={setReadiness} />
                        ) : (
                          <section className="p-5 sm:p-6">
                            <registryEntry.setupSection sydekyk={sydekyk} canManage onReadiness={setReadiness} />
                          </section>
                        )
                      )}
                      {sydekyk.workflow_enabled && !registryEntry?.hideReviewerAssignment && (
                        <section className="p-5 sm:p-6">
                          <ReviewerAssignment sydekykId={sydekyk.id} canManage />
                        </section>
                      )}
                      {registryEntry?.playbookPanel && (
                        <section className="p-5 sm:p-6">
                          <registryEntry.playbookPanel />
                        </section>
                      )}
                    </div>
                  </Card>
                ) : null}
              </>
            ) : (
              <Card className="p-6 text-center text-sm text-body">
                Install this Sydekyk to configure its AI engine and put it to work.
              </Card>
            )}
          </div>
        )}
      </main>
      <TypeUIPanel />
      <ConfirmUninstallModal
        sydekykName={sydekyk?.name ?? ""}
        open={confirmRemove}
        pending={pending}
        onConfirm={confirmUninstall}
        onClose={() => setConfirmRemove(false)}
      />
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
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-success-strong">
        <span className="h-2 w-2 rounded-full bg-success shadow-[var(--shadow-sm)]" /> Good to go
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
        <p className="mt-2 text-sm text-body">Loading…</p>
      ) : editing ? (
        <EngineForm sydekyk={sydekyk} config={config} credentials={credentials} onCancel={() => setEditing(false)} onSaved={handleSaved} />
      ) : (
        <div className="mt-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-heading">{ENGINE_LABEL[config.provider]}</p>
              {config.model && <p className="text-xs text-body">{config.model}</p>}
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
            <p className={`mt-2 text-xs ${testResult.ok ? "text-success-strong" : "text-danger-strong"}`}>{testResult.message}</p>
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
    "w-full rounded-[4px] border-2 border-ink-600 bg-ink-800 px-4 py-3 text-base text-heading focus:border-gold-500";

  return (
    <form onSubmit={handleSubmit} className="mt-3 grid gap-3">
      <div>
        <Label>Engine</Label>
        <select className={selectClass} value={provider} onChange={(e) => setProvider(e.target.value as LLMProvider)}>
          <option value="power_core">Power Core (Sydekyks-hosted)</option>
          <option value="openai" disabled={!connected.has("openai")}>
            OpenAI {!connected.has("openai") && " -  connect in Settings"}
          </option>
          <option value="anthropic" disabled={!connected.has("anthropic")}>
            Anthropic {!connected.has("anthropic") && " -  connect in Settings"}
          </option>
          <option value="ollama_cloud" disabled={!connected.has("ollama_cloud")}>
            Ollama Cloud {!connected.has("ollama_cloud") && " -  connect in Settings"}
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
