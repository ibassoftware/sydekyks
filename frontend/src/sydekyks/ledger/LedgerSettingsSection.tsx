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
import { Badge, Button, Input, Label } from "../../components/ui";
import { GadgetRequirementList } from "../../components/GadgetRequirementList";
import { LedgerReadinessCard } from "./LedgerReadinessCard";
import { useTenantCurrency } from "../../lib/useTenantCurrency";
import { SettingsBand, SettingsToggle } from "../SettingsLayout";

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
  const currency = useTenantCurrency();
  const [settings, setSettings] = useState<LedgerSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [readinessKey, setReadinessKey] = useState(0); // bump to force the readiness card to re-fetch

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
    <>
      <SettingsBand title="Readiness" description="What Ledger can use now and anything that needs your attention.">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(240px,0.6fr)]">
          <LedgerReadinessCard onReadiness={onReadiness} refreshKey={readinessKey} showHeading={false} />
          <IssuesQuickLink sydekykId={sydekyk.id} />
        </div>
      </SettingsBand>

      <SettingsBand id="gadgets" title="Connections" description="Where bills arrive and where Ledger records the result.">
        <div className="grid gap-6 xl:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold text-heading">Odoo</h3>
            <div className="mt-3"><GadgetRequirementList sydekykId={sydekyk.id} canManage={canManage} /></div>
          </div>
          <div className="border-t-2 border-ink-600 pt-6 xl:border-l-2 xl:border-t-0 xl:pl-6 xl:pt-0">
            <EmailInboxBlock canManage={canManage} />
          </div>
        </div>
      </SettingsBand>

      <SettingsBand id="ledger-automation" title="Automation" description="How confidently Ledger may turn a document into an Odoo bill.">
        <VisionTestBlock
          settings={settings}
          canManage={canManage}
          onTested={(s) => {
            setSettings(s);
            setReadinessKey((k) => k + 1);
          }}
        />

        {settings && (
          <div className="mt-6 border-t-2 border-ink-600 pt-2">
            <SettingsToggle
              label="Require a purchase-order match"
              description="When a bill cites a PO (or source order), cross-check the Odoo order's vendor, currency, total, and quantities — mismatches stay as drafts for review. Bills with no PO reference post normally."
              checked={settings.purchase_order_match_enabled}
              disabled={!canManage || saving}
              onChange={(checked) => save({ ...settings, purchase_order_match_enabled: checked })}
            />
            <SettingsToggle
              label="Create missing vendors"
              description="Add a new Odoo vendor when no matching record exists."
              checked={settings.auto_create_partner}
              disabled={!canManage || saving}
              onChange={(checked) => save({ ...settings, auto_create_partner: checked })}
            />
            <SettingsToggle
              label="Auto-post vendor bills"
              description="Allow sufficiently confident bills to move beyond draft automatically."
              checked={settings.auto_post_enabled}
              disabled={!canManage || saving}
              onChange={(checked) => save({ ...settings, auto_post_enabled: checked })}
            />

            {settings.auto_post_enabled && (
              <div className="border-t-2 border-ink-600 py-5">
                <Label>Auto-post threshold (confidence %)</Label>
                <div className="flex items-center gap-4">
                  <input
                    type="range" min={0} max={100} step={5}
                    className="min-h-11 flex-1 accent-gold-500"
                    disabled={!canManage || saving}
                    value={settings.auto_post_threshold}
                    onChange={(e) => setSettings({ ...settings, auto_post_threshold: Number(e.target.value) })}
                    onMouseUp={(e) => save({ ...settings, auto_post_threshold: Number((e.target as HTMLInputElement).value) })}
                  />
                  <span className="w-12 text-right text-base font-semibold tabular-nums text-heading">{settings.auto_post_threshold}%</span>
                </div>
                <p className="mt-2 text-xs text-body">Currency, tax, and purchase-order checks can still prevent automatic posting.</p>
              </div>
            )}
          </div>
        )}
      </SettingsBand>

      {settings && (
        <SettingsBand id="savings" title="Value assumptions" description="The business inputs behind Ledger's money-saved estimate.">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Hourly wage ({currency})</Label>
              <Input
                type="number"
                min={0}
                step={0.5}
                disabled={!canManage || saving}
                value={settings.estimated_hourly_wage}
                onChange={(e) => setSettings({ ...settings, estimated_hourly_wage: Number(e.target.value) })}
                onBlur={(e) => save({ ...settings, estimated_hourly_wage: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label>Minutes to manually enter one bill</Label>
              <Input
                type="number"
                min={0}
                step={0.5}
                disabled={!canManage || saving}
                value={settings.estimated_minutes_per_bill}
                onChange={(e) => setSettings({ ...settings, estimated_minutes_per_bill: Number(e.target.value) })}
                onBlur={(e) => save({ ...settings, estimated_minutes_per_bill: Number(e.target.value) })}
              />
            </div>
          </div>
          <p className="mt-3 text-xs text-body">These values estimate the manual data-entry cost avoided on the Command Center dashboard.</p>
        </SettingsBand>
      )}
    </>
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
      to={`/hq/missions?view=attention&sydekyk_id=${sydekykId}`}
      className="flex min-h-28 items-center justify-between gap-4 rounded-[4px] border-2 border-ink-600 bg-ink-900 p-5 shadow-[var(--shadow-xs)] transition-colors hover:bg-ink-800 sm:p-6"
    >
      <div>
        <h3 className="text-sm font-semibold text-heading">Attention</h3>
        <p className="mt-2 text-sm text-body">
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
    <div id="ledger-vision" className="scroll-mt-24">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-heading">Document-reading test</h3>
          <p className="mt-2 text-xs leading-5 text-body">
            {verified === true
              ? "Verified — your engine read a sample invoice correctly."
              : verified === false
                ? "Last run: your engine couldn't read the sample invoice. Check the AI Engine above, then try again."
                : "Before your first real upload, confirm your AI engine can actually read a bill."}
            {" "}This sends a built-in sample invoice through your engine and checks it extracts the details — it's
            more thorough than the engine's plain connection test.
          </p>
        </div>
        {canManage && (
          <Button variant="ghost" className="whitespace-nowrap px-3 py-1.5 text-xs" disabled={testing} onClick={runTest}>
            {testing ? "Reading sample…" : "Test with a sample bill"}
          </Button>
        )}
      </div>
      {result && (
        <p className={`mt-2 text-xs leading-5 ${result.ok ? "text-success-strong" : "text-danger-strong"}`}>
          {result.message}
        </p>
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
      <h3 className="text-sm font-semibold text-heading">Email intake <span className="font-normal text-body">(optional)</span></h3>
      {address ? (
        <div className="mt-3 rounded-lg border border-ink-700 p-3">
          <p className="text-xs text-body">Forward or email bills to:</p>
          <div className="mt-1 flex items-center justify-between gap-3">
            <code className="min-w-0 truncate text-sm text-gold-300">{address}</code>
            <Button variant="ghost" className="shrink-0 px-3 py-1 text-xs" onClick={copy}>
              {copied ? "Copied ✓" : "Copy"}
            </Button>
          </div>
          <p className="mt-2 text-xs text-body">
            Send a bill (PDF or image) to this address; a Mission appears in history within a few seconds.
          </p>
        </div>
      ) : (
        <div className="mt-3">
          <p className="text-sm text-body">No inbound email connected yet.</p>
          {canManage && (
            <Button variant="ghost" className="mt-2 px-3 py-1.5 text-xs" disabled={creating} onClick={createInbox}>
              {creating ? "Creating…" : "Create Email Inbox"}
            </Button>
          )}
          {error && <p className="mt-2 text-xs text-danger-strong">{error}</p>}
        </div>
      )}
    </div>
  );
}
