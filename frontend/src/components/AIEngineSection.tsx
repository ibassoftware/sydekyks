import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import axios from "axios";
import {
  api,
  type LLMProvider,
  type ProviderCredential,
  type Sydekyk,
  type SydekykLLMConfig,
  type SydekykLLMConfigTestResult,
} from "../lib/api";
import { Badge, Button, Input, Label } from "./ui";

const ENGINE_LABEL: Record<LLMProvider, string> = {
  power_core: "Power Core",
  openai: "OpenAI",
  anthropic: "Anthropic",
  ollama_cloud: "Ollama Cloud",
};

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

/** The per-agent AI engine picker + connection test. `embedded` drops the "AI ENGINE" kicker so it
 * can sit inside a labelled step card; the shared SydekykDetail uses the default (header) form. */
export function AIEngineSection({
  sydekyk,
  canManage,
  embedded = false,
  onChanged,
}: {
  sydekyk: Sydekyk;
  canManage: boolean;
  embedded?: boolean;
  onChanged?: () => void;
}) {
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
    onChanged?.();
  }

  async function handleTest() {
    setTesting(true);
    try {
      const res = await api.post<SydekykLLMConfigTestResult>(`/tenant/sydekyks/${sydekyk.id}/llm-config/test`);
      setConfig(res.data.config);
      setTestResult({ ok: res.data.ok, message: res.data.message });
      onChanged?.();
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.data?.detail) {
        setTestResult({ ok: false, message: err.response.data.detail });
      }
    } finally {
      setTesting(false);
    }
  }

  const changeEngineButton =
    canManage && !editing && config ? (
      <Button variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => setEditing(true)}>
        Change Engine
      </Button>
    ) : undefined;

  return (
    <div>
      {!embedded && <SectionHeader title="AI Engine" action={changeEngineButton} />}

      {!config ? (
        <p className={embedded ? "text-sm text-body" : "mt-2 text-sm text-body"}>Loading…</p>
      ) : editing ? (
        <EngineForm sydekyk={sydekyk} config={config} credentials={credentials} onCancel={() => setEditing(false)} onSaved={handleSaved} />
      ) : (
        <div className={embedded ? "" : "mt-3"}>
          <div className="flex flex-wrap items-center justify-between gap-3">
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
              {embedded && changeEngineButton}
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
