import { useEffect, useState } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import {
  api,
  type EmailInboxOut,
  type IssuesOut,
  type LedgerReadiness,
  type LedgerSettings,
  type Sydekyk,
  type VisionTestResult,
} from "../../lib/api";
import { Badge, Button, Label } from "../../components/ui";
import { GadgetRequirementList } from "../../components/GadgetRequirementList";
import { LedgerReadinessCard } from "./LedgerReadinessCard";

/** VS-9 registry setup section for Ledger. Composes the readiness checklist (VS-1), gadget
 * assignment, the email-inbox experience (VS-2), business settings, and the vision test (VS-12). */
export function LedgerSettingsSection({
  sydekyk,
  canManage,
  onReadiness,
}: {
  sydekyk: Sydekyk;
  canManage: boolean;
  onReadiness?: (r: LedgerReadiness) => void;
}) {
  const [settings, setSettings] = useState<LedgerSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<LedgerSettings>("/tenant/ledger/settings").then((res) => setSettings(res.data));
  }, []);

  async function save(next: LedgerSettings) {
    setSettings(next);
    if (!canManage) return;
    setSaving(true);
    try {
      const res = await api.put<LedgerSettings>("/tenant/ledger/settings", next);
      setSettings(res.data);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-6">
      <LedgerReadinessCard onReadiness={onReadiness} />

      <IssuesQuickLink sydekykId={sydekyk.id} />

      <div id="gadgets">
        <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Integrations</p>
        <div className="mt-3">
          <GadgetRequirementList sydekykId={sydekyk.id} canManage={canManage} />
        </div>
      </div>

      <EmailInboxBlock canManage={canManage} />

      <div id="ai-engine">
        <VisionTestBlock settings={settings} canManage={canManage} onTested={setSettings} />
      </div>

      {settings && (
        <div className="grid gap-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Posting Rules</p>
          <label className="flex items-center gap-2 text-sm text-[#ede6da]">
            <input
              type="checkbox"
              className="h-4 w-4 accent-gold-500"
              disabled={!canManage || saving}
              checked={settings.auto_create_partner}
              onChange={(e) => save({ ...settings, auto_create_partner: e.target.checked })}
            />
            Auto-create vendors in Odoo when not found
          </label>

          <label className="flex items-center gap-2 text-sm text-[#ede6da]">
            <input
              type="checkbox"
              className="h-4 w-4 accent-gold-500"
              disabled={!canManage || saving}
              checked={settings.auto_post_enabled}
              onChange={(e) => save({ ...settings, auto_post_enabled: e.target.checked })}
            />
            Auto-post vendor bills
          </label>
          {!settings.auto_post_enabled && (
            <p className="-mt-2 text-xs text-[#8a7f6d]">
              Every bill stays a draft in Odoo for a human to review and post.
            </p>
          )}

          {settings.auto_post_enabled && (
            <div>
              <Label>Auto-post threshold (confidence %)</Label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  className="flex-1 accent-gold-500"
                  disabled={!canManage || saving}
                  value={settings.auto_post_threshold}
                  onChange={(e) => setSettings({ ...settings, auto_post_threshold: Number(e.target.value) })}
                  onMouseUp={(e) => save({ ...settings, auto_post_threshold: Number((e.target as HTMLInputElement).value) })}
                />
                <span className="w-10 text-right text-sm text-[#ede6da]">{settings.auto_post_threshold}%</span>
              </div>
              <p className="mt-1 text-xs text-[#8a7f6d]">
                Bills at or above this confidence are posted automatically; below, they wait as drafts.
                A bill is also never auto-posted if its currency or tax couldn't be matched in Odoo.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function IssuesQuickLink({ sydekykId }: { sydekykId: string }) {
  const [issues, setIssues] = useState<IssuesOut | null>(null);

  useEffect(() => {
    api.get<IssuesOut>("/tenant/issues", { params: { sydekyk_id: sydekykId } }).then((res) => setIssues(res.data));
  }, [sydekykId]);

  if (!issues) return null;
  const total = issues.config_issues.length + issues.missions_needing_review.length;

  return (
    <Link
      to={`/hq/issues?sydekyk_id=${sydekykId}`}
      className="flex items-center justify-between rounded-lg border border-ink-700 px-4 py-3 transition-colors hover:border-gold-500/60"
    >
      <div>
        <p className="text-sm font-semibold text-[#ede6da]">Issues</p>
        <p className="text-xs text-[#8a7f6d]">
          {total === 0 ? "Nothing needs attention" : `${total} ${total === 1 ? "thing needs" : "things need"} attention`}
        </p>
      </div>
      {total > 0 ? <Badge tone="danger">{total}</Badge> : <Badge tone="gold">All clear</Badge>}
    </Link>
  );
}

function VisionTestBlock({
  settings,
  canManage,
  onTested,
}: {
  settings: LedgerSettings | null;
  canManage: boolean;
  onTested: (s: LedgerSettings) => void;
}) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<VisionTestResult | null>(null);

  async function runTest() {
    setTesting(true);
    setResult(null);
    try {
      const res = await api.post<VisionTestResult>("/tenant/ledger/vision-test");
      setResult(res.data);
      const s = await api.get<LedgerSettings>("/tenant/ledger/settings");
      onTested(s.data);
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.data?.detail) setResult({ ok: false, message: err.response.data.detail });
    } finally {
      setTesting(false);
    }
  }

  const verified = settings?.ledger_vision_ok;

  return (
    <div className="rounded-lg border border-ink-700 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[#ede6da]">Ledger readiness test</p>
          <p className="text-xs text-[#8a7f6d]">
            {verified === true
              ? "Your engine can read invoices."
              : verified === false
                ? "Last test: this engine couldn't read a sample invoice."
                : "Confirm your AI engine can actually read a bill before the first upload."}
          </p>
        </div>
        {canManage && (
          <Button variant="ghost" className="whitespace-nowrap px-3 py-1.5 text-xs" disabled={testing} onClick={runTest}>
            {testing ? "Testing…" : "Test with a sample bill"}
          </Button>
        )}
      </div>
      {result && (
        <p className={`mt-2 text-xs ${result.ok ? "text-gold-400" : "text-red-400"}`}>{result.message}</p>
      )}
    </div>
  );
}

function EmailInboxBlock({ canManage }: { canManage: boolean }) {
  const [address, setAddress] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Reuse readiness to discover an already-assigned inbox address.
  useEffect(() => {
    api.get<LedgerReadiness>("/tenant/ledger/readiness").then((res) => {
      const item = res.data.items.find((i) => i.key === "email_inbox");
      if (item?.state === "ok" && item.detail) setAddress(item.detail);
    });
  }, []);

  async function createInbox() {
    setCreating(true);
    setError(null);
    try {
      const res = await api.post<EmailInboxOut>("/tenant/ledger/email-inbox", { name: "Ledger Inbox" });
      setAddress(res.data.inbound_address);
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.data?.detail) setError(err.response.data.detail);
      else setError("Couldn't create the inbox.");
    } finally {
      setCreating(false);
    }
  }

  function copy() {
    if (!address) return;
    navigator.clipboard?.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div id="email">
      <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Email intake (optional)</p>
      {address ? (
        <div className="mt-3 rounded-lg border border-ink-700 p-3">
          <p className="text-xs text-[#8a7f6d]">Forward or email bills to:</p>
          <div className="mt-1 flex items-center justify-between gap-3">
            <code className="min-w-0 truncate text-sm text-gold-300">{address}</code>
            <Button variant="ghost" className="shrink-0 px-3 py-1 text-xs" onClick={copy}>
              {copied ? "Copied ✓" : "Copy"}
            </Button>
          </div>
          <p className="mt-2 text-xs text-[#8a7f6d]">
            Send a bill (PDF or image) to this address; a Mission appears in history within a few seconds.
          </p>
        </div>
      ) : (
        <div className="mt-3">
          <p className="text-sm text-[#8a7f6d]">No inbound email connected yet.</p>
          {canManage && (
            <Button variant="ghost" className="mt-2 px-3 py-1.5 text-xs" disabled={creating} onClick={createInbox}>
              {creating ? "Creating…" : "Create Email Inbox"}
            </Button>
          )}
          {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        </div>
      )}
    </div>
  );
}
