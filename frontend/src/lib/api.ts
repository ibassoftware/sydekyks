import axios from "axios";

export const api = axios.create({
  baseURL: "/api",
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("sydekyks_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export type Role = "super_admin" | "commander" | "hero";

export interface User {
  id: string;
  email: string;
  role: Role;
  tenant_id: string | null;
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  plan: string;
  created_at: string;
}

export interface Dashboard {
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  plan: string;
  plan_display_name: string;
  roster_sydekyk_count: number;
  exclusive_sydekyk_count: number;
  tokens_used_this_month: number;
  monthly_token_cap: number;
  token_throttled: boolean;
  gpu_seconds_used_last_hour: number;
  gpu_seconds_per_hour_cap: number;
  gpu_throttled: boolean;
}

export interface LedgerDailyTrend {
  date: string;
  succeeded: number;
  failed: number;
}

export interface LedgerInsights {
  activated: boolean;
  total_missions: number;
  succeeded_missions: number;
  failed_missions: number;
  needs_review_missions: number;
  posted_count: number;
  daily_trend: LedgerDailyTrend[];
  estimated_hourly_wage: number;
  estimated_minutes_per_bill: number;
  estimated_manual_cost: number;
  ai_cost: number;
  estimated_net_savings: number;
}

// --- HQ team management (RBAC) ---

export interface TeamUser {
  id: string;
  email: string;
  role: Role;
  created_at: string;
  is_self: boolean;
}

export interface SydekykPermission {
  sydekyk_id: string;
  sydekyk_name: string;
  is_exclusive: boolean;
  can_use: boolean;
  can_configure: boolean;
}

export interface Sydekyk {
  id: string;
  name: string;
  slug: string;
  tagline: string;
  description: string;
  avatar_url: string;
  model: string;
  is_exclusive: boolean;
  chat_enabled: boolean;
  workflow_enabled: boolean;
  accepts_document_uploads: boolean;
  installed: boolean;
  created_at: string;
}

export interface SydekykAdmin {
  id: string;
  tenant_id: string | null;
  name: string;
  slug: string;
  tagline: string;
  description: string;
  avatar_url: string;
  model: string;
  is_exclusive: boolean;
  is_published: boolean;
  chat_enabled: boolean;
  workflow_enabled: boolean;
  created_at: string;
}

export interface Gadget {
  id: string;
  name: string;
  slug: string;
  type: string;
  category: string;
  description: string;
}

export type GadgetLinkStatus = "untested" | "connected" | "error";

export interface GadgetLink {
  id: string;
  gadget: Gadget;
  name: string;
  category: string;
  url: string | null;
  database: string | null;
  username: string | null;
  inbound_address: string | null;
  status: GadgetLinkStatus;
  last_tested_at: string | null;
  last_test_error: string | null;
  created_at: string;
}

export interface GadgetLinkCreate {
  gadget_slug: string;
  name: string;
  url?: string;
  database?: string;
  username?: string;
  secret?: string;
}

export interface GadgetLinkTestResult {
  ok: boolean;
  message: string;
  link: GadgetLink;
}

// "power_core" = Sydekyks-hosted; the rest are tenant BYOK connections.
export type LLMProvider = "power_core" | "openai" | "anthropic" | "ollama_cloud";
export type BYOKProvider = "openai" | "anthropic" | "ollama_cloud";
export type LLMConfigStatus = "untested" | "connected" | "error";

export interface ProviderCredential {
  provider: BYOKProvider;
  has_api_key: boolean;
  api_base: string | null;
  updated_at: string | null;
}

export interface ProviderCredentialUpdate {
  api_key: string;
  api_base?: string;
}

export interface ModelListResult {
  ok: boolean;
  message: string;
  models: string[];
}

export interface SydekykLLMConfig {
  sydekyk_id: string;
  provider: LLMProvider;
  model: string | null;
  status: LLMConfigStatus;
  last_tested_at: string | null;
  last_test_error: string | null;
}

export interface SydekykLLMConfigUpdate {
  provider: LLMProvider;
  model?: string;
}

export interface SydekykLLMConfigTestResult {
  ok: boolean;
  message: string;
  config: SydekykLLMConfig;
}

export interface SydekykUsage {
  spend_used: number;
  stale: boolean;
}

export interface TenantUsageBreakdownItem {
  sydekyk_id: string;
  sydekyk_name: string;
  spend_used: number;
  stale: boolean;
}

export interface ProviderKey {
  provider: string;
  has_api_key: boolean;
  api_base: string | null;
  updated_at: string | null;
}

export interface ProviderKeyUpdate {
  api_key: string;
  api_base?: string;
}

// --- GPU-second metering + per-tenant plan caps (Command Center) ---

export interface MeteringConfig {
  prompt_rate: number;
  generation_rate: number;
}

export interface ModelRate {
  model: string;
  multiplier: number;
}

export interface PlanTier {
  key: string;
  display_name: string;
  monthly_token_cap: number;
  gpu_seconds_per_hour_cap: number;
  sort_order: number;
}

export interface TenantUsageLimit {
  tenant_id: string;
  tenant_name: string;
  plan: string;
  plan_display_name: string;
  monthly_token_cap: number;
  tokens_used_this_month: number;
  token_throttled: boolean;
  gpu_seconds_per_hour_cap: number;
  gpu_seconds_used_last_hour: number;
  gpu_throttled: boolean;
  monthly_token_cap_override: number | null;
  gpu_seconds_per_hour_cap_override: number | null;
}

export interface TenantPlanUpdate {
  plan: string;
  monthly_token_cap_override: number | null;
  gpu_seconds_per_hour_cap_override: number | null;
}

export interface HostedAssignment {
  sydekyk_id: string;
  hosted_provider: string | null;
  hosted_model: string | null;
}

export interface HostedAssignmentUpdate {
  hosted_provider: string;
  hosted_model: string;
}

// --- Mission engine (generic) + Ledger ---

export type MissionStatus = "queued" | "running" | "succeeded" | "failed";

export interface MissionStep {
  step_index: number;
  step_key: string;
  step_type: string;
  status: string;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface Mission {
  id: string;
  sydekyk_id: string;
  sydekyk_name: string | null;
  tenant_name?: string | null;  // set only by the admin Command Center cross-tenant view
  playbook_key: string;
  signal_type: string;
  source: string | null;
  initiated_by_email?: string | null;
  status: MissionStatus;
  failure_category: string | null;
  result_summary: Record<string, unknown> | null;
  error_message: string | null;
  document_filename: string | null;
  last_step_key: string | null;
  reviewed?: boolean;
  odoo_bill_url?: string | null;  // only populated on the mission-detail endpoint
  parent_mission_id: string | null;
  root_mission_id: string | null;
  attempt_number: number;
  created_at: string;
  completed_at: string | null;
}

export interface MissionDetail extends Mission {
  steps: MissionStep[];
}

export interface MissionPage {
  items: Mission[];
  total: number;
  limit: number;
  offset: number;
}

export interface MissionFilters {
  sydekyk_id?: string;
  status?: MissionStatus;
  signal_type?: string;
  source?: string;
  filename?: string;
  date_from?: string;
  date_to?: string;
  needs_review?: boolean;
  limit?: number;
  offset?: number;
}

// --- Ledger-owned surfaces (readiness, playbook, vision test, email inbox) ---

export type ReadinessState = "ok" | "warn" | "blocked";

export interface ReadinessItem {
  key: string;
  label: string;
  state: ReadinessState;
  detail: string | null;
  action_label: string | null;
  action_href: string | null;
}

export interface LedgerReadiness {
  items: ReadinessItem[];
  can_upload: boolean;
  last_inbound_email: string | null;
}

export interface PlaybookStep {
  key: string;
  title: string;
  description: string;
  likely_failures: string;
}

export interface LedgerPlaybook {
  playbook_key: string;
  editable: boolean;
  steps: PlaybookStep[];
}

export interface VisionTestResult {
  ok: boolean;
  message: string;
}

export interface EmailInboxOut {
  link_id: string;
  inbound_address: string;
}

// --- Tenant Issues (standing config gaps + missions flagged for review) ---

export interface TenantIssue {
  id: string;
  sydekyk_id: string | null;
  sydekyk_name: string | null;
  kind: string;
  title: string;
  detail: string | null;
  status: "open" | "resolved";
  occurrence_count: number;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  odoo_bill_url: string | null;
}

export interface MissionReviewItem {
  mission_id: string;
  sydekyk_name: string | null;
  document_filename: string | null;
  reason: string | null;
  created_at: string;
  odoo_bill_url: string | null;
  vendor_name: string | null;
  invoice_number: string | null;
  total: number | null;
  currency: string | null;
  posted: boolean | null;
  duplicate: boolean | null;
  reviewed: boolean;
  reviewed_at: string | null;
  reviewed_by_email: string | null;
}

export interface IssuesOut {
  config_issues: TenantIssue[];
  resolved_issues: TenantIssue[];
  missions_needing_review: MissionReviewItem[];
}

export interface IssuesCount {
  config_issues: number;
  missions_needing_review: number;
  total: number;
}

export interface MissionReviewStatus {
  mission_id: string;
  reviewed: boolean;
  reviewed_at: string | null;
  reviewed_by_email: string | null;
}

export interface EligibleLink {
  id: string;
  name: string;
}

export interface GadgetRequirement {
  requirement_id: string;
  role_key: string;
  label: string;
  gadget_category: string;
  is_required: boolean;
  eligible_links: EligibleLink[];
  assigned_link_id: string | null;
}

export interface LedgerSettings {
  auto_create_partner: boolean;
  auto_post_enabled: boolean;
  auto_post_threshold: number;
  ledger_vision_ok?: boolean | null;
  ledger_vision_tested_at?: string | null;
  estimated_hourly_wage: number;
  estimated_minutes_per_bill: number;
}

// --- Decode (résumé parser) ---
export interface DecodeSettings {
  auto_create_skills: boolean;
  processed_tag_name: string;
  pooling_stage_name: string | null;
  cron_enabled: boolean;
  cron_poll_limit: number;
}
export interface DecodeReadiness {
  items: ReadinessItem[];
  can_upload: boolean;
  last_inbound_email: string | null;
}
export interface DecodePlaybook {
  playbook_key: string;
  editable: boolean;
  steps: PlaybookStep[];
}
export interface DecodeInsights {
  activated: boolean;
  total_applicants: number;
  with_job_count: number;
  pooling_count: number;
  needs_review_count: number;
  top_skills: { skill: string; count: number }[];
  daily_trend: { date: string; count: number }[];
}

// --- Scout (résumé scorer) ---
export interface ScoutSettings {
  processed_tag_name: string;
  min_score_threshold: number;
  scoring_rubric: string | null;
  cron_enabled: boolean;
  cron_poll_limit: number;
}
export interface ScoutReadiness {
  items: ReadinessItem[];
  can_upload: boolean;
}
export interface ScoutPlaybook {
  playbook_key: string;
  editable: boolean;
  steps: PlaybookStep[];
}
export interface RunNowResult {
  queued: number;
}
export interface ScoutInsights {
  activated: boolean;
  total_scored: number;
  average_score: number;
  needs_review_count: number;
  distribution: { band: string; count: number }[];
  top_candidates: { applicant_name: string | null; job_name: string | null; score: number }[];
  daily_trend: { date: string; count: number }[];
}
