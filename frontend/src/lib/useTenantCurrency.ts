import { useEffect, useState } from "react";
import { api, type TenantSettings } from "./api";

/** The tenant's reporting currency, loaded once and shared across every card (module-level cache +
 * in-flight dedupe). Used as the currency for figures that have no intrinsic one — chiefly the
 * labor-cost savings on the dashboard and the wage inputs in agent settings. Defaults to "USD". */
let cache: string | null = null;
let inflight: Promise<string> | null = null;

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

/** Let a settings screen push the freshly-saved value so every card updates without a reload. */
export function setTenantCurrency(code: string) {
  cache = code;
}

export function useTenantCurrency(): string {
  const [currency, setCurrency] = useState<string>(cache ?? "USD");
  useEffect(() => {
    let alive = true;
    load().then((c) => {
      if (alive) setCurrency(c);
    });
    return () => {
      alive = false;
    };
  }, []);
  return currency;
}
