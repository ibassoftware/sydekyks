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
  power_meter_quota: number;
}
