import type { ComponentType } from "react";
import type { LedgerReadiness, Mission, Sydekyk } from "../lib/api";
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

/** VS-9: a deliberately plain per-Sydekyk UI registry — mirrors the backend's per-Sydekyk package
 * structure. No dynamic imports, no plugin framework; it just lets a Sydekyk provide optional UI so
 * shared files (SydekykDetail, DocumentIntakeSection) stay generic. Grow the shape at Sydekyk #2. */
export interface SydekykSetupProps {
  sydekyk: Sydekyk;
  canManage: boolean;
  onReadiness?: (r: LedgerReadiness) => void;
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

export interface SydekykRegistryEntry {
  setupSection?: ComponentType<SydekykSetupProps>;
  playbookPanel?: ComponentType;
  missionSummary?: ComponentType<{ summary: Record<string, unknown> }>;
  uploadContext?: ComponentType<UploadContextProps>;
  /** Domain tints the Mission row: HR Sydekyks (Decode/Scout) get a bluish hue; accounting (Ledger)
   * uses the default. */
  domain?: "hr";
  /** The business-meaningful row headline (falls back to the filename when absent). */
  missionRowLabel?: (m: Mission) => MissionRowLabel;
}

const SEP = "  ·  ";

/** Fallback headline when a Mission produced no business object yet (queued/running) or was rejected
 * (failed) — the friendly error already reads like "This doesn't look like a résumé…". */
function fallbackRowLabel(m: Mission): MissionRowLabel {
  if (m.status === "failed" && m.error_message) return { title: m.error_message, muted: true };
  return { title: m.document_filename ?? "Processing…", muted: true };
}

function ledgerRowLabel(m: Mission): MissionRowLabel {
  const s = m.result_summary ?? {};
  const vendor = s.vendor_name as string | undefined;
  if (!vendor) return fallbackRowLabel(m);
  const parts = [vendor];
  if (s.invoice_number) parts.push(`#${s.invoice_number}`);
  if (typeof s.total === "number") parts.push(`${(s.currency as string) ?? ""} ${(s.total as number).toFixed(2)}`.trim());
  return { title: parts.join(SEP) };
}

function decodeRowLabel(m: Mission): MissionRowLabel {
  const s = m.result_summary ?? {};
  const name = s.applicant_name as string | undefined;
  if (!name) return fallbackRowLabel(m);
  const parts = [name];
  if (s.pooling) parts.push("Pool");
  else if (s.job_name) parts.push(s.job_name as string);
  return { title: parts.join(SEP) };
}

function scoutRowLabel(m: Mission): MissionRowLabel {
  const s = m.result_summary ?? {};
  const name = s.applicant_name as string | undefined;
  if (!name) return fallbackRowLabel(m);
  const parts = [name];
  if (s.job_name) parts.push(s.job_name as string);
  if (typeof s.score === "number") parts.push(`${s.score as number}/100`);
  return { title: parts.join(SEP) };
}

const BY_SLUG: Record<string, SydekykRegistryEntry> = {
  ledger: {
    setupSection: LedgerSettingsSection,
    playbookPanel: LedgerPlaybookPanel,
    missionSummary: LedgerMissionSummary,
    missionRowLabel: ledgerRowLabel,
  },
  decode: {
    setupSection: DecodeSettingsSection,
    playbookPanel: DecodePlaybookPanel,
    missionSummary: DecodeMissionSummary,
    uploadContext: DecodeUploadContext,
    domain: "hr",
    missionRowLabel: decodeRowLabel,
  },
  scout: {
    setupSection: ScoutSettingsSection,
    playbookPanel: ScoutPlaybookPanel,
    missionSummary: ScoutMissionSummary,
    domain: "hr",
    missionRowLabel: scoutRowLabel,
  },
};

const BY_PLAYBOOK: Record<string, SydekykRegistryEntry> = {
  "ledger.vendor_bill_ingest": { missionSummary: LedgerMissionSummary, missionRowLabel: ledgerRowLabel },
  "decode.resume_parse": { missionSummary: DecodeMissionSummary, domain: "hr", missionRowLabel: decodeRowLabel },
  "scout.resume_score": { missionSummary: ScoutMissionSummary, domain: "hr", missionRowLabel: scoutRowLabel },
};

export function registryForSlug(slug: string | undefined): SydekykRegistryEntry | undefined {
  return slug ? BY_SLUG[slug] : undefined;
}

export function registryForPlaybook(playbookKey: string | undefined): SydekykRegistryEntry | undefined {
  return playbookKey ? BY_PLAYBOOK[playbookKey] : undefined;
}
