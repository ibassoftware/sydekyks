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

export interface SydekykRegistryEntry {
  setupSection?: ComponentType<SydekykSetupProps>;
  playbookPanel?: ComponentType;
  missionSummary?: ComponentType<{ summary: Record<string, unknown> }>;
  uploadContext?: ComponentType<UploadContextProps>;
  /** Domain tints the Mission row: HR Sydekyks (Decode/Scout) get a bluish hue; accounting (Ledger)
   * uses the default. */
  domain?: "hr";
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

const BY_SLUG: Record<string, SydekykRegistryEntry> = {
  ledger: {
    setupSection: LedgerSettingsSection,
    playbookPanel: LedgerPlaybookPanel,
    missionSummary: LedgerMissionSummary,
    missionRowLabel: ledgerRowLabel,
    reviewNoun: { one: "bill", many: "bills" },
  },
  decode: {
    setupSection: DecodeSettingsSection,
    playbookPanel: DecodePlaybookPanel,
    missionSummary: DecodeMissionSummary,
    uploadContext: DecodeUploadContext,
    domain: "hr",
    missionRowLabel: decodeRowLabel,
    reviewNoun: { one: "applicant", many: "applicants" },
  },
  scout: {
    setupSection: ScoutSettingsSection,
    playbookPanel: ScoutPlaybookPanel,
    missionSummary: ScoutMissionSummary,
    operationsPanel: ScoutOperationsSection,
    domain: "hr",
    missionRowLabel: scoutRowLabel,
  },
  mirror: {
    setupSection: MirrorSettingsSection,
    playbookPanel: MirrorPlaybookPanel,
    missionSummary: MirrorMissionSummary,
    operationsPanel: MirrorOperationsSection,
    missionRowLabel: mirrorRowLabel,
    reviewNoun: { one: "duplicate", many: "duplicates" },
  },
};

const BY_PLAYBOOK: Record<string, SydekykRegistryEntry> = {
  "ledger.vendor_bill_ingest": { missionSummary: LedgerMissionSummary, missionRowLabel: ledgerRowLabel },
  "decode.resume_parse": { missionSummary: DecodeMissionSummary, domain: "hr", missionRowLabel: decodeRowLabel },
  "scout.resume_score": { missionSummary: ScoutMissionSummary, domain: "hr", missionRowLabel: scoutRowLabel },
  "mirror.duplicate_check": { missionSummary: MirrorMissionSummary, missionRowLabel: mirrorRowLabel },
};

export function registryForSlug(slug: string | undefined): SydekykRegistryEntry | undefined {
  return slug ? BY_SLUG[slug] : undefined;
}

export function registryForPlaybook(playbookKey: string | undefined): SydekykRegistryEntry | undefined {
  return playbookKey ? BY_PLAYBOOK[playbookKey] : undefined;
}
