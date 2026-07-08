import type { ComponentType } from "react";
import type { LedgerReadiness, Sydekyk } from "../lib/api";
import { LedgerSettingsSection } from "./ledger/LedgerSettingsSection";
import { LedgerPlaybookPanel } from "./ledger/LedgerPlaybookPanel";
import { LedgerMissionSummary } from "./ledger/LedgerMissionSummary";
import { DecodeSettingsSection } from "./decode/DecodeSettingsSection";
import { DecodePlaybookPanel } from "./decode/DecodePlaybookPanel";
import { DecodeMissionSummary } from "./decode/DecodeMissionSummary";
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

export interface SydekykRegistryEntry {
  setupSection?: ComponentType<SydekykSetupProps>;
  playbookPanel?: ComponentType;
  missionSummary?: ComponentType<{ summary: Record<string, unknown> }>;
}

const BY_SLUG: Record<string, SydekykRegistryEntry> = {
  ledger: {
    setupSection: LedgerSettingsSection,
    playbookPanel: LedgerPlaybookPanel,
    missionSummary: LedgerMissionSummary,
  },
  decode: {
    setupSection: DecodeSettingsSection,
    playbookPanel: DecodePlaybookPanel,
    missionSummary: DecodeMissionSummary,
  },
  scout: {
    setupSection: ScoutSettingsSection,
    playbookPanel: ScoutPlaybookPanel,
    missionSummary: ScoutMissionSummary,
  },
};

const BY_PLAYBOOK: Record<string, SydekykRegistryEntry> = {
  "ledger.vendor_bill_ingest": { missionSummary: LedgerMissionSummary },
  "decode.resume_parse": { missionSummary: DecodeMissionSummary },
  "scout.resume_score": { missionSummary: ScoutMissionSummary },
};

export function registryForSlug(slug: string | undefined): SydekykRegistryEntry | undefined {
  return slug ? BY_SLUG[slug] : undefined;
}

export function registryForPlaybook(playbookKey: string | undefined): SydekykRegistryEntry | undefined {
  return playbookKey ? BY_PLAYBOOK[playbookKey] : undefined;
}
