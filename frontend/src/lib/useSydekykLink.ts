import { useEffect, useState } from "react";
import { api, type Sydekyk } from "./api";

/** Slug → sydekyk id, loaded once and shared across every dashboard card (module-level cache +
 * in-flight dedupe) so N insight cards cost one `/tenant/sydekyks` fetch, not N. */
let cache: Record<string, string> | null = null;
let inflight: Promise<Record<string, string>> | null = null;

function loadMap(): Promise<Record<string, string>> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = api
      .get<Sydekyk[]>("/tenant/sydekyks")
      .then((r) => {
        cache = Object.fromEntries(r.data.map((s) => [s.slug, s.id]));
        return cache;
      })
      .catch(() => {
        inflight = null; // let a later card retry
        return {};
      });
  }
  return inflight;
}

/** The HQ route to an agent's detail/settings page for a given slug, or null until resolved. */
export function useSydekykLink(slug: string): string | null {
  const initial = cache && cache[slug] ? `/hq/roster/${cache[slug]}` : null;
  const [href, setHref] = useState<string | null>(initial);
  useEffect(() => {
    let alive = true;
    loadMap().then((m) => {
      if (alive && m[slug]) setHref(`/hq/roster/${m[slug]}`);
    });
    return () => {
      alive = false;
    };
  }, [slug]);
  return href;
}
