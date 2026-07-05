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
  roster_sydekyk_count: number;
  exclusive_sydekyk_count: number;
  power_meter_used: number;
  power_meter_quota: number | null;
  power_meter_stale: boolean;
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
  description: string;
}

export type GadgetLinkStatus = "untested" | "connected" | "error";

export interface GadgetLink {
  id: string;
  gadget: Gadget;
  name: string;
  url: string;
  database: string;
  username: string;
  status: GadgetLinkStatus;
  last_tested_at: string | null;
  last_test_error: string | null;
  created_at: string;
}

export interface GadgetLinkCreate {
  gadget_slug: string;
  name: string;
  url: string;
  database: string;
  username: string;
  secret: string;
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

export interface HostedAssignment {
  sydekyk_id: string;
  hosted_provider: string | null;
  hosted_model: string | null;
}

export interface HostedAssignmentUpdate {
  hosted_provider: string;
  hosted_model: string;
}
