import { useEffect, useState } from "react";
import { api, type TenantSettings } from "./api";

/** The tenant's reporting currency, loaded once and shared across every card (module-level cache +
 * in-flight dedupe). It's the display currency for the whole dashboard and the wage inputs in agent
 * settings. Amounts are NOT FX-converted - a tenant's Odoo is single-currency and should match this.
 * Defaults to "USD". */
let cache: string | null = null;
let inflight: Promise<string> | null = null;
const subscribers = new Set<(c: string) => void>();

function load(): Promise<string> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = api
      .get<TenantSettings>("/tenant/settings")
      .then((r) => {
        cache = r.data.currency || "USD";
        return cache;
      })
      .catch(() => {
        inflight = null;
        return "USD";
      });
  }
  return inflight;
}

/** Push a freshly-saved value so every mounted card re-renders immediately - no page reload. */
export function setTenantCurrency(code: string) {
  cache = code;
  subscribers.forEach((fn) => fn(code));
}

export function useTenantCurrency(): string {
  const [currency, setCurrency] = useState<string>(cache ?? "USD");
  useEffect(() => {
    subscribers.add(setCurrency);
    load().then(setCurrency);
    return () => {
      subscribers.delete(setCurrency);
    };
  }, []);
  return currency;
}
