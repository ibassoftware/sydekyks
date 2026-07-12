import type { ComponentType } from "react";
import type { LedgerReadiness, Sydekyk } from "../lib/api";
import { LedgerSettingsSection } from "./ledger/LedgerSettingsSection";
import { LedgerPlaybookPanel } from "./ledger/LedgerPlaybookPanel";
import { LedgerMissionSummary } from "./ledger/LedgerMissionSummary";
import { DecodeSettingsSection } from "./decode/DecodeSettingsSection";
import { DecodePlaybookPanel } from "./decode/DecodePlaybookPanel";
import { DecodeMissionSummary } from "./decode/DecodeMissionSummary";
import { DecodeUploadContext } from "./decode/DecodeUploadContext";
import { ScoutSettingsSection } from "./scout/ScoutSettingsSection";
import { ScoutPlaybookPanel } from "./scout/ScoutPlaybookPanel";
import { ScoutMissionSummary } from "./scout/ScoutMissionSummary";
import { ScoutOperationsSection } from "./scout/ScoutOperationsSection";
import { MirrorSettingsSection } from "./mirror/MirrorSettingsSection";
import { MirrorPlaybookPanel } from "./mirror/MirrorPlaybookPanel";
import { MirrorMissionSummary } from "./mirror/MirrorMissionSummary";
import { MirrorOperationsSection } from "./mirror/MirrorOperationsSection";
import { ShieldSettingsSection } from "./shield/ShieldSettingsSection";
import { ShieldPlaybookPanel } from "./shield/ShieldPlaybookPanel";
import { ShieldMissionSummary } from "./shield/ShieldMissionSummary";
import { ShieldOperationsSection } from "./shield/ShieldOperationsSection";
import { NudgeSettingsSection } from "./nudge/NudgeSettingsSection";
import { NudgePlaybookPanel } from "./nudge/NudgePlaybookPanel";
import { NudgeMissionSummary } from "./nudge/NudgeMissionSummary";
import { NudgeOperationsSection } from "./nudge/NudgeOperationsSection";

/** VS-9: a deliberately plain per-Sydekyk UI registry — mirrors the backend's per-Sydekyk package
 * structure. No dynamic imports, no plugin framework; it just lets a Sydekyk provide optional UI so
 * shared files (SydekykDetail, DocumentIntakeSection) stay generic. Grow the shape at Sydekyk #2. */
export interface SydekykSetupProps {
  sydekyk: Sydekyk;
  canManage: boolean;
  onReadiness?: (r: LedgerReadiness) => void;
}

/** An operations area for a Sydekyk that has no upload dropzone but still runs work on demand
 * (Scout's batch "Run now" + Recent Missions). Rendered prominently, above configuration. */
export interface OperationsProps {
  sydekyk: Sydekyk;
  canManage: boolean;
}

/** A control shown above a Sydekyk's upload dropzone that contributes per-upload context (stored on
 * each Mission's trigger_context). Decode uses it to pick the applied-for Odoo job. */
export interface UploadContextProps {
  value: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
}

/** The headline a Mission row shows instead of the raw filename — the business object the Mission
 * produced (a bill, an applicant). `muted` marks a fallback (still processing, or the document was
 * rejected, e.g. "not a résumé") so the row can render it subdued. */
export interface MissionRowLabel {
  title: string;
  muted?: boolean;
}

/** The minimal Mission shape the row-label builders read — satisfied by both a full `Mission` (list
 * rows) and a `MissionReviewItem` (the Issues review rows), so both surfaces share one headline. */
export interface RowLabelInput {
  id?: string; // used to vary the leading verb deterministically (stable per mission)
  result_summary?: Record<string, unknown> | null;
  document_filename?: string | null;
  status?: string;
  error_message?: string | null;
}

/** The departments Sydekyks are grouped under on the roster, in display order. */
export type FunctionGroup = "sales" | "accounting" | "hr";

export const FUNCTION_GROUPS: { key: FunctionGroup; label: string }[] = [
  { key: "sales", label: "Sales" },
  { key: "accounting", label: "Accounting" },
  { key: "hr", label: "HR" },
];

export interface SydekykRegistryEntry {
  setupSection?: ComponentType<SydekykSetupProps>;
  playbookPanel?: ComponentType;
  missionSummary?: ComponentType<{ summary: Record<string, unknown> }>;
  uploadContext?: ComponentType<UploadContextProps>;
  /** Domain tints the Mission row: HR Sydekyks (Decode/Scout) get a bluish hue; accounting (Ledger)
   * uses the default. */
  domain?: "hr";
  /** The business function this Sydekyk serves — used to group the roster by department
   * (Sales · Accounting · HR). */
  functionGroup?: FunctionGroup;
  /** The business-meaningful row headline (falls back to the filename when absent). */
  missionRowLabel?: (m: RowLabelInput) => MissionRowLabel;
  /** A prominent operations area for non-upload Sydekyks (Scout's "Run now" + Recent Missions). */
  operationsPanel?: ComponentType<OperationsProps>;
  /** What a needs-review item is called for this Sydekyk (Ledger: bill, Decode: applicant). */
  reviewNoun?: { one: string; many: string };
}

/** Pick a stable-but-varied item from a pool, keyed off the mission id, so a row always reads the
 * same but adjacent rows use different verbs (avoids a wall of identical "Scored… Scored… Scored"). */
function pick<T>(pool: T[], seed: string | undefined): T {
  let h = 2166136261;
  for (const ch of seed ?? "") h = (Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0);
  return pool[h % pool.length];
}

const LEDGER_VERBS = ["Encoded", "Booked", "Filed", "Recorded", "Captured", "Logged"];
const DECODE_VERBS = ["Parsed", "Read", "Filed", "Captured", "Logged", "Processed"];
const SCOUT_VERBS = ["Graded", "Scored", "Evaluated", "Assessed", "Rated", "Reviewed"];
const MIRROR_VERBS = ["Checked", "Scanned", "Inspected", "Vetted", "Screened", "Reviewed"];
const SHIELD_VERBS = ["Assessed", "Screened", "Reviewed", "Audited", "Vetted", "Examined"];
const NUDGE_VERBS = ["Nudged", "Followed up on", "Chased", "Revived", "Re-engaged", "Warmed"];

/** Fallback headline when a Mission produced no business object yet (queued/running) or was rejected
 * (failed) — the friendly error already reads like "This doesn't look like a résumé…". */
function fallbackRowLabel(m: RowLabelInput): MissionRowLabel {
  if (m.status === "failed" && m.error_message) return { title: m.error_message, muted: true };
  return { title: m.document_filename ?? "Processing…", muted: true };
}

function ledgerRowLabel(m: RowLabelInput): MissionRowLabel {
  const s = m.result_summary ?? {};
  const vendor = s.vendor_name as string | undefined;
  if (!vendor) return fallbackRowLabel(m);
  const verb = pick(LEDGER_VERBS, m.id);
  const inv = s.invoice_number ? ` ${s.invoice_number}` : "";
  const amount = typeof s.total === "number" ? ` · ${(s.currency as string) ?? ""} ${(s.total as number).toFixed(2)}`.trimEnd() : "";
  return { title: `${verb} the bill${inv} by ${vendor}${amount}` };
}

function decodeRowLabel(m: RowLabelInput): MissionRowLabel {
  const s = m.result_summary ?? {};
  const name = s.applicant_name as string | undefined;
  if (!name) return fallbackRowLabel(m);
  const verb = pick(DECODE_VERBS, m.id);
  const where = s.pooling ? " into the pool" : s.job_name ? ` for ${s.job_name}` : "";
  return { title: `${verb} the résumé of ${name}${where}` };
}

function scoutRowLabel(m: RowLabelInput): MissionRowLabel {
  const s = m.result_summary ?? {};
  const name = s.applicant_name as string | undefined;
  if (!name) return fallbackRowLabel(m);
  const verb = pick(SCOUT_VERBS, m.id);
  const score = typeof s.score === "number" ? ` · ${s.score as number}/100` : "";
  return { title: `${verb} the application of ${name}${score}` };
}

function mirrorRowLabel(m: RowLabelInput): MissionRowLabel {
  const s = m.result_summary ?? {};
  const vendor = s.vendor_name as string | undefined;
  if (!vendor) return fallbackRowLabel(m);
  const verb = pick(MIRROR_VERBS, m.id);
  const ref = s.ref ? ` ${s.ref}` : "";
  const flag = s.is_duplicate
    ? ` · possible duplicate (${(s.confidence as number) ?? 0}%)`
    : s.suppressed
      ? " · recurring"
      : " · unique";
  return { title: `${verb} the bill${ref} by ${vendor}${flag}` };
}

function shieldRowLabel(m: RowLabelInput): MissionRowLabel {
  const s = m.result_summary ?? {};
  const vendor = s.vendor_name as string | undefined;
  if (!vendor) return fallbackRowLabel(m);
  const verb = pick(SHIELD_VERBS, m.id);
  const ref = s.ref ? ` ${s.ref}` : "";
  const flag = s.hold
    ? ` · HARD-HOLD (risk ${(s.risk_score as number) ?? 0})`
    : s.needs_review
      ? ` · warrants review (risk ${(s.risk_score as number) ?? 0})`
      : " · no risk signals";
  return { title: `${verb} the bill${ref} by ${vendor}${flag}` };
}

function nudgeRowLabel(m: RowLabelInput): MissionRowLabel {
  const s = m.result_summary ?? {};
  if (s.mode === "nudge_sweep") {
    const open = (s.open_total as number) ?? 0;
    // enqueued = opps sent to the playbook for a closer look (not yet confirmed stale). Fall back to
    // the old key for missions logged before the breakdown existed.
    const queued = (s.enqueued as number) ?? (s.stale_enqueued as number) ?? 0;
    const tail = queued > 0 ? `${queued} queued for review` : "all tended, nothing to chase";
    return { title: `Checked the pipeline · ${open} open · ${tail}`, muted: queued === 0 };
  }
  const opp = s.opp_name as string | undefined;
  if (!opp) return fallbackRowLabel(m);
  const skipped = s.skipped as string | undefined;
  if (skipped === "snoozed") return { title: `Left ${opp} alone — paused deal`, muted: true };
  if (skipped === "cadence") return { title: `Held off on ${opp} — nudged recently`, muted: true };
  if (skipped === "future_activity") return { title: `${opp} — next touch already scheduled`, muted: true };
  if (s.stale === false) return { title: `${opp} — still fresh, no nudge needed`, muted: true };
  const verb = pick(NUDGE_VERBS, m.id);
  const days = typeof s.days_stale === "number" ? ` · silent ${s.days_stale as number}d` : "";
  return { title: `${verb} ${opp}${days}` };
}

const BY_SLUG: Record<string, SydekykRegistryEntry> = {
  nudge: {
    setupSection: NudgeSettingsSection,
    playbookPanel: NudgePlaybookPanel,
    missionSummary: NudgeMissionSummary,
    operationsPanel: NudgeOperationsSection,
    missionRowLabel: nudgeRowLabel,
    functionGroup: "sales",
    reviewNoun: { one: "follow-up", many: "follow-ups" },
  },
  ledger: {
    setupSection: LedgerSettingsSection,
    playbookPanel: LedgerPlaybookPanel,
    missionSummary: LedgerMissionSummary,
    missionRowLabel: ledgerRowLabel,
    functionGroup: "accounting",
    reviewNoun: { one: "bill", many: "bills" },
  },
  decode: {
    setupSection: DecodeSettingsSection,
    playbookPanel: DecodePlaybookPanel,
    missionSummary: DecodeMissionSummary,
    uploadContext: DecodeUploadContext,
    domain: "hr",
    functionGroup: "hr",
    missionRowLabel: decodeRowLabel,
    reviewNoun: { one: "applicant", many: "applicants" },
  },
  scout: {
    setupSection: ScoutSettingsSection,
    playbookPanel: ScoutPlaybookPanel,
    missionSummary: ScoutMissionSummary,
    operationsPanel: ScoutOperationsSection,
    domain: "hr",
    functionGroup: "hr",
    missionRowLabel: scoutRowLabel,
  },
  mirror: {
    setupSection: MirrorSettingsSection,
    playbookPanel: MirrorPlaybookPanel,
    missionSummary: MirrorMissionSummary,
    operationsPanel: MirrorOperationsSection,
    missionRowLabel: mirrorRowLabel,
    functionGroup: "accounting",
    reviewNoun: { one: "duplicate", many: "duplicates" },
  },
  shield: {
    setupSection: ShieldSettingsSection,
    playbookPanel: ShieldPlaybookPanel,
    missionSummary: ShieldMissionSummary,
    operationsPanel: ShieldOperationsSection,
    missionRowLabel: shieldRowLabel,
    functionGroup: "accounting",
    reviewNoun: { one: "risk alert", many: "risk alerts" },
  },
};

/** The department a Sydekyk belongs to, for grouping the roster (falls back to Sales-less "other"). */
export function functionGroupForSlug(slug: string | undefined): FunctionGroup | undefined {
  return slug ? BY_SLUG[slug]?.functionGroup : undefined;
}

const BY_PLAYBOOK: Record<string, SydekykRegistryEntry> = {
  "ledger.vendor_bill_ingest": { missionSummary: LedgerMissionSummary, missionRowLabel: ledgerRowLabel },
  "decode.resume_parse": { missionSummary: DecodeMissionSummary, domain: "hr", missionRowLabel: decodeRowLabel },
  "scout.resume_score": { missionSummary: ScoutMissionSummary, domain: "hr", missionRowLabel: scoutRowLabel },
  "mirror.duplicate_check": { missionSummary: MirrorMissionSummary, missionRowLabel: mirrorRowLabel },
  "shield.risk_assess": { missionSummary: ShieldMissionSummary, missionRowLabel: shieldRowLabel },
  "nudge.followup": { missionSummary: NudgeMissionSummary, missionRowLabel: nudgeRowLabel },
};

export function registryForSlug(slug: string | undefined): SydekykRegistryEntry | undefined {
  return slug ? BY_SLUG[slug] : undefined;
}

export function registryForPlaybook(playbookKey: string | undefined): SydekykRegistryEntry | undefined {
  return playbookKey ? BY_PLAYBOOK[playbookKey] : undefined;
}
