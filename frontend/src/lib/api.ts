import axios from "axios";
import { toast } from "./toast";

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

// Global "Saved" feedback for settings changes (DRY — one place, every settings form). A settings
// save is a PUT (or a gadget-assignment DELETE/unassign). Changing the AI engine or the Odoo
// connection gates the agent's readiness, so we reload afterwards to re-fetch it.
api.interceptors.response.use((response) => {
  const method = (response.config.method || "").toLowerCase();
  const url = response.config.url || "";
  const isSettingsSave = method === "put" || (method === "delete" && /gadget-requirements|reviewers|recurring/.test(url));
  if (isSettingsSave) {
    const affectsReadiness = /llm-config|gadget-requirements/.test(url);
    toast.success(affectsReadiness ? "Saved — refreshing…" : "Saved");
    if (affectsReadiness) {
      setTimeout(() => window.location.reload(), 750);
    }
  }
  return response;
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
  currency: string;
  roster_sydekyk_count: number;
  exclusive_sydekyk_count: number;
  tokens_used_this_month: number;
  monthly_token_cap: number;
  token_throttled: boolean;
  gpu_seconds_used_last_hour: number;
  gpu_seconds_per_hour_cap: number;
  gpu_throttled: boolean;
}

export interface TenantSettings {
  currency: string;
  supported_currencies: string[];
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
  processing_seconds: number;
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

// --- Review assignment (shared across all agents) ---
export interface OdooUser {
  id: number;
  name: string;
  login: string | null;
}
export interface ReviewerConfig {
  create_activity: boolean;
  odoo_user_ids: number[];
  activity_days: number;
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
  can_use: boolean;
  can_configure: boolean;
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
  odoo_record_url?: string | null;  // generic Odoo deep link (e.g. the applicant) — detail endpoint only
  odoo_record_label?: string | null;
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
  completed_at: string | null;
  playbook_key: string | null;
  result_summary: Record<string, unknown> | null;
  odoo_bill_url: string | null;
  odoo_record_url: string | null;
  odoo_record_label: string | null;
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
  max_resume_pages: number;
  estimated_hourly_wage: number;
  estimated_minutes_per_resume: number;
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
export interface DecodeJob {
  id: number;
  name: string;
}
export interface DecodeJobsOut {
  connected: boolean;
  jobs: DecodeJob[];
  message: string | null;
}
export interface DecodeInsights {
  activated: boolean;
  total_applicants: number;
  with_job_count: number;
  pooling_count: number;
  needs_review_count: number;
  top_skills: { skill: string; count: number }[];
  applications_by_position: { job_name: string; count: number }[];
  data_quality: {
    with_email: number;
    with_phone: number;
    with_skills: number;
    with_experience: number;
    needs_review: number;
  } | null;
  seniority_mix: { band: string; count: number }[];
  daily_trend: { date: string; count: number }[];
  estimated_hourly_wage: number;
  estimated_minutes_each: number;
  estimated_manual_cost: number;
  ai_cost: number;
  estimated_net_savings: number;
  processing_seconds: number;
}

// --- Scout (résumé scorer) ---
export interface ScoutSettings {
  processed_tag_name: string;
  estimated_hourly_wage: number;
  estimated_minutes_per_candidate: number;
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
export interface ShortlistCandidate {
  applicant_name: string | null;
  score: number;
  summary: string | null;
  odoo_url: string | null;
}
export interface RoleHealth {
  job_name: string;
  scored: number;
  strong: number;
  avg_score: number;
  top_score: number;
  top_candidates: ShortlistCandidate[];
}
export interface ScoutInsights {
  activated: boolean;
  total_scored: number;
  average_score: number;
  strong_count: number;
  distribution: { band: string; count: number }[];
  role_health: RoleHealth[];
  common_strengths: { label: string; count: number }[];
  common_weaknesses: { label: string; count: number }[];
  daily_trend: { date: string; count: number }[];
  estimated_hourly_wage: number;
  estimated_minutes_each: number;
  estimated_manual_cost: number;
  ai_cost: number;
  estimated_net_savings: number;
  processing_seconds: number;
}

// --- Mirror (duplicate bill detector) ---
export interface MirrorSettings {
  date_window_days: number;
  include_drafts: boolean;
  flag_threshold: number;
  estimated_hourly_wage: number;
  estimated_minutes_per_review: number;
  cron_enabled: boolean;
  cron_poll_limit: number;
  cron_days_back: number;
}
export interface MirrorReadiness {
  items: ReadinessItem[];
  can_upload: boolean;
}
export interface MirrorPlaybook {
  playbook_key: string;
  editable: boolean;
  steps: PlaybookStep[];
}
export interface MirrorFlag {
  odoo_move_id: number;
  vendor_name: string | null;
  ref: string | null;
  amount: number | null;
  currency: string | null;
  confidence: number;
  tier: string | null;
  reasons: string[];
  odoo_url: string | null;
  human_decision: string | null;
  finding_id: string;
}
export interface MirrorInsights {
  activated: boolean;
  total_checked: number;
  duplicates_found: number;
  suppressed_count: number;
  prevented_amount: number;
  currency: string | null;
  by_tier: { tier: string; count: number }[];
  daily_trend: { date: string; count: number }[];
  estimated_hourly_wage: number;
  estimated_minutes_each: number;
  estimated_manual_cost: number;
  ai_cost: number;
  estimated_net_savings: number;
  processing_seconds: number;
}
export interface RecurringPattern {
  id: string;
  partner_id: number;
  vendor_name: string | null;
  amount: number | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
}
export interface MirrorFlagPage {
  items: MirrorFlag[];
  total: number;
  limit: number;
  offset: number;
}

// --- Shield (fraud risk detector) ---
export interface ShieldSettings {
  recent_change_days: number;
  high_amount_threshold: number;
  flag_threshold: number;
  estimated_hourly_wage: number;
  estimated_minutes_per_review: number;
  cron_enabled: boolean;
  cron_poll_limit: number;
  cron_days_back: number;
}
export interface ShieldReadiness {
  items: ReadinessItem[];
  can_upload: boolean;
}
export interface ShieldPlaybook {
  playbook_key: string;
  editable: boolean;
  steps: PlaybookStep[];
}
export interface ShieldRuleFlag {
  code: string;
  label: string;
  weight: number;
  evidence: string | null;
}
export interface ShieldAlert {
  odoo_move_id: number;
  vendor_name: string | null;
  ref: string | null;
  amount: number | null;
  currency: string | null;
  risk_score: number;
  hold: boolean;
  flags: ShieldRuleFlag[];
  summary: string | null;
  odoo_url: string | null;
  human_decision: string | null;
  finding_id: string;
}
export interface ShieldQueuePage {
  items: ShieldAlert[];
  total: number;
  limit: number;
  offset: number;
}
export interface ShieldInsights {
  activated: boolean;
  total_assessed: number;
  flagged_count: number;
  holds_count: number;
  exposure_amount: number;
  currency: string | null;
  top_rules: { label: string; count: number }[];
  daily_trend: { date: string; count: number }[];
  estimated_hourly_wage: number;
  estimated_minutes_each: number;
  estimated_manual_cost: number;
  ai_cost: number;
  estimated_net_savings: number;
  processing_seconds: number;
}

// --- Nudge (sales follow-up) ---
export interface NudgeStageThreshold {
  stage_id: number;
  stage_name?: string | null;
  days: number;
}
export interface NudgeSettings {
  default_stale_days: number;
  stage_thresholds: NudgeStageThreshold[];
  cadence_days: number;
  activity_days: number;
  estimated_hourly_wage: number;
  estimated_minutes_per_followup: number;
  cron_enabled: boolean;
  cron_poll_limit: number;
}
export interface NudgeStage {
  id: number;
  name: string | null;
  is_won: boolean;
}
export interface NudgeOpportunity {
  id: number;
  name: string | null;
  partner_name: string | null;
  stage_name: string | null;
  salesperson: string | null;
  expected_revenue: number | null;
}
export interface NudgeReadiness {
  items: ReadinessItem[];
  can_upload: boolean;
}
export interface NudgePlaybook {
  playbook_key: string;
  editable: boolean;
  steps: PlaybookStep[];
}
export interface NudgeItem {
  finding_id: string;
  odoo_lead_id: number;
  opp_name: string | null;
  partner_name: string | null;
  salesperson: string | null;
  stage_name: string | null;
  expected_revenue: number | null;
  currency: string | null;
  days_stale: number;
  silence_score: number;
  value_at_risk: number | null;
  overdue: boolean;
  activity_created: boolean;
  draft_body: string | null;
  odoo_url: string | null;
  human_decision: string | null;
}
export interface NudgeQueuePage {
  items: NudgeItem[];
  total: number;
  limit: number;
  offset: number;
}
export interface NudgeSnoozeEntry {
  id: string;
  odoo_lead_id: number;
  opp_name: string | null;
  snooze_until: string | null;
  note: string | null;
  created_by: string | null;
}
export interface NudgeInsights {
  activated: boolean;
  open_total: number;
  stale_caught: number;
  coverage_pct: number;
  followups_drafted: number;
  value_at_risk_total: number;
  currency: string | null;
  top_stages: { label: string; count: number }[];
  daily_trend: { date: string; count: number }[];
  estimated_hourly_wage: number;
  estimated_minutes_each: number;
  estimated_manual_cost: number;
  ai_cost: number;
  estimated_net_savings: number;
  processing_seconds: number;
}

// --- Quill (proposal generator) ---
export interface QuillReadiness {
  items: ReadinessItem[];
  can_upload: boolean;
}
export interface QuillSettings {
  default_template_id: string | null;
  page_size: string;
  accent_color: string | null;
  estimated_hourly_wage: number;
  estimated_minutes_per_proposal: number;
  auto_create_quotation: boolean;
  merge_quotation_pdf: boolean;
  upload_to_quotation: boolean;
}
export interface QuillTemplateSummary {
  id: string;
  name: string;
  format: "html" | "md";
  is_builtin: boolean;
}
export interface QuillTemplate extends QuillTemplateSummary {
  body: string;
  created_by: string | null;
  updated_at: string | null;
}
export interface QuillProposalSummary {
  id: string;
  title: string;
  status: "draft" | "final";
  customer_name: string | null;
  odoo_sale_order_name: string | null;
  updated_at: string;
}
export interface QuillProposal {
  id: string;
  title: string;
  status: "draft" | "final";
  content_html: string;
  customer_name: string | null;
  template_id: string | null;
  odoo_lead_id: number | null;
  odoo_sale_order_id: number | null;
  odoo_sale_order_name: string | null;
  token_total: number;
  cost_usd: number;
  updated_at: string;
}
export interface QuillProposalPage {
  items: QuillProposalSummary[];
  total: number;
  limit: number;
  offset: number;
}
export interface QuillChatMessage {
  id: string;
  seq: number;
  role: "user" | "assistant";
  content: string;
  total_tokens: number;
  created_at: string;
}
export interface QuillChatHistory {
  messages: QuillChatMessage[];
  proposal_token_total: number;
  proposal_cost_usd: number;
}
export interface QuillChatResult {
  reply: string;
  changed_summary: string;
  proposal: QuillProposal;
  turn_tokens: { prompt_tokens: number; completion_tokens: number; total_tokens: number; cost_usd: number };
  proposal_token_total: number;
  proposal_cost_usd: number;
}
export interface QuillAsset {
  id: string;
  url: string;
  data_uri: string;
  filename: string;
}
export interface QuillOpportunity {
  id: number;
  name: string | null;
  partner_name: string | null;
  stage_name: string | null;
  expected_revenue: number | null;
}
export interface QuillQuotation {
  odoo_sale_order_id: number;
  odoo_sale_order_name: string | null;
  amount_total: number | null;
  currency: string | null;
  odoo_url: string | null;
}
export interface QuillInsights {
  activated: boolean;
  proposals_created: number;
  proposals_final: number;
  revisions: number;
  total_tokens: number;
  ai_cost: number;
  top_customers: { label: string; count: number }[];
  estimated_hourly_wage: number;
  estimated_minutes_each: number;
  estimated_manual_cost: number;
  estimated_net_savings: number;
  processing_seconds: number;
}
