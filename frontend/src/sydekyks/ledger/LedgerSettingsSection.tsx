import { useEffect, useState, type ReactNode } from "react";
import axios from "axios";
import {
  api,
  type EmailInboxOut,
  type LedgerReadiness,
  type LedgerSettings,
  type ReadinessItem,
  type ReadinessState,
  type Sydekyk,
  type VisionTestResult,
} from "../../lib/api";
import { Badge, Button, Input, Label } from "../../components/ui";
import { AIEngineSection } from "../../components/AIEngineSection";
import { GadgetRequirementList } from "../../components/GadgetRequirementList";
import { useTenantCurrency } from "../../lib/useTenantCurrency";
import { SettingsBand, SettingsToggle } from "../SettingsLayout";

const STEP_STATE: Record<ReadinessState, { label: string; tone: "success" | "warning" | "danger"; badge: string }> = {
  ok: { label: "Done", tone: "success", badge: "border-success bg-success text-ink-950" },
  warn: { label: "To do", tone: "warning", badge: "border-warning text-warning" },
  blocked: { label: "Required", tone: "danger", badge: "border-danger text-danger" },
};

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
  const [readiness, setReadiness] = useState<LedgerReadiness | null>(null);
  const [readinessKey, setReadinessKey] = useState(0); // bump to re-fetch readiness after a step changes

  useEffect(() => {
    api.get<LedgerSettings>("/tenant/ledger/settings").then((res) => setSettings(res.data));
  }, []);

  useEffect(() => {
    api.get<LedgerReadiness>("/tenant/ledger/readiness").then((res) => {
      setReadiness(res.data);
      onReadiness?.(res.data);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readinessKey]);

  const refreshReadiness = () => setReadinessKey((k) => k + 1);
  const byKey = new Map((readiness?.items ?? []).map((i) => [i.key, i]));
  const odooStep = odooStatus(byKey);
  const requiredSteps = [byKey.get("ai_engine"), byKey.get("vision"), odooStep].filter(
    (s): s is ReadinessItem => Boolean(s),
  );
  const doneCount = requiredSteps.filter((s) => s.state === "ok").length;

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
      <SettingsBand id="gadgets" title="Get Ledger ready" description="Complete these steps to start processing bills.">
        {readiness && (
          <SetupProgress done={doneCount} total={requiredSteps.length} next={requiredSteps.find((s) => s.state !== "ok")} />
        )}
        <ol className="mt-5 grid gap-4">
          <StepCard n={1} title="Set up the AI engine" status={byKey.get("ai_engine")}
            help="Choose and verify the model that reads your bills.">
            <AIEngineSection sydekyk={sydekyk} canManage={canManage} embedded onChanged={refreshReadiness} />
          </StepCard>
          <StepCard n={2} title="Read a test document" status={byKey.get("vision")} anchor="ledger-vision"
            help="Confirm the engine can actually read an invoice before your first upload.">
            <VisionTestBlock settings={settings} canManage={canManage}
              onTested={(s) => { setSettings(s); refreshReadiness(); }} />
          </StepCard>
          <StepCard n={3} title="Connect Odoo" status={odooStep}
            help="Where Ledger reads vendors and records the finished bill.">
            <GadgetRequirementList sydekykId={sydekyk.id} canManage={canManage} categories={["erp"]} onChanged={refreshReadiness} />
          </StepCard>
          <StepCard n={4} title="Email inbox" optional status={byKey.get("email_inbox")}
            help="Optional — get a dedicated address to forward or email bills to.">
            <EmailInboxBlock canManage={canManage} onChanged={refreshReadiness} />
          </StepCard>
        </ol>
      </SettingsBand>

      <SettingsBand id="ledger-automation" title="Automation" description="How confidently Ledger may turn a document into an Odoo bill.">
        {settings && (
          <div>
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

/** Combine the two Odoo readiness rows (assigned + connection) into a single step status. */
function odooStatus(byKey: Map<string, ReadinessItem>): ReadinessItem | undefined {
  const assigned = byKey.get("odoo_assigned");
  const connection = byKey.get("odoo_connection");
  if (!assigned) return undefined;
  if (assigned.state !== "ok") return assigned;
  if (connection && connection.state !== "ok") return connection;
  return assigned;
}

function SetupProgress({ done, total, next }: { done: number; total: number; next?: ReadinessItem }) {
  const allDone = done >= total && total > 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="rounded-[4px] border-2 border-ink-600 bg-ink-900 p-5 shadow-[var(--shadow-xs)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-heading">
            {allDone ? "Ledger is ready" : `Setup — ${done} of ${total} steps done`}
          </p>
          <p className="mt-1 text-xs text-body">
            {allDone ? "You can upload or email bills now." : next ? `Next: ${next.label.toLowerCase()}.` : "Getting things ready…"}
          </p>
        </div>
        <Badge tone={allDone ? "success" : "warning"}>{allDone ? "Ready" : "In progress"}</Badge>
      </div>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full border border-ink-600 bg-ink-800">
        <div className="h-full rounded-full bg-gold-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function StepCard({
  n,
  title,
  help,
  status,
  optional,
  anchor,
  children,
}: {
  n: number;
  title: string;
  help?: string;
  status?: ReadinessItem;
  optional?: boolean;
  anchor?: string;
  children: ReactNode;
}) {
  const st = status ? STEP_STATE[status.state] : null;
  const done = status?.state === "ok";
  return (
    <li id={anchor} className="scroll-mt-24 rounded-[4px] border-2 border-ink-600 bg-ink-900 p-5 shadow-[var(--shadow-xs)]">
      <div className="flex items-start gap-4">
        <span
          aria-hidden="true"
          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold tabular-nums ${
            st?.badge ?? "border-ink-600 text-body"
          }`}
        >
          {done ? "✓" : n}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-heading">
              {title}
              {optional && <span className="ml-2 text-xs font-normal text-body">optional</span>}
            </h3>
            {st && <Badge tone={st.tone}>{st.label}</Badge>}
          </div>
          {help && <p className="mt-1 text-xs leading-5 text-body">{help}</p>}
          <div className="mt-4">{children}</div>
        </div>
      </div>
    </li>
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
  const status = result
    ? { ok: result.ok, text: result.message }
    : verified === true
      ? { ok: true, text: "Verified — your engine read a sample invoice." }
      : verified === false
        ? { ok: false, text: "Last run failed. Check the AI engine above, then retry." }
        : null;

  return (
    <div>
      {canManage && (
        <Button variant="ghost" className="whitespace-nowrap px-3 py-1.5 text-xs" disabled={testing} onClick={runTest}>
          {testing ? "Reading sample…" : "Test with a sample bill"}
        </Button>
      )}
      {status && (
        <p className={`mt-2 text-xs leading-5 ${status.ok ? "text-success-strong" : "text-danger-strong"}`}>
          {status.text}
        </p>
      )}
    </div>
  );
}

function EmailInboxBlock({ canManage, onChanged }: { canManage: boolean; onChanged?: () => void }) {
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
      onChanged?.();
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
