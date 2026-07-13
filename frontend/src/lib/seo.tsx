/** Dep-free, per-route <head> management for the public marketing pages. Sets title / description /
 * canonical / Open Graph / Twitter tags on mount + route change, and can inject JSON-LD structured
 * data. Managed tags are marked with `data-seo` and reused across routes (same key set), so routes
 * overwrite rather than leak tags into each other.
 *
 * These run client-side, but the build-time prerender (scripts/prerender.mjs) drives a headless
 * browser and snapshots the populated <head>, so crawlers and non-JS social scrapers get real HTML. */
import { useEffect } from "react";

/** Absolute site origin for canonical + OG URLs. Override per-env with VITE_SITE_URL. */
export const SITE_URL = (import.meta.env.VITE_SITE_URL ?? "https://sydekyks.ai").replace(/\/$/, "");
export const SITE_NAME = "Sydekyks";
const DEFAULT_OG_IMAGE = "/og-cover.png";

export interface SeoProps {
  /** Full <title> text (caller decides branding suffix). */
  title: string;
  description: string;
  /** Route path, e.g. "/" or "/sydekyks/ledger" — used to build the canonical + og:url. */
  path: string;
  /** OG/Twitter image path or absolute URL (defaults to the site share image). */
  image?: string;
  /** OG type — "website" for the landing, "article" for a Sydekyk page. */
  type?: "website" | "article";
  /** Optional JSON-LD structured-data object(s) to inject. */
  jsonLd?: object | object[];
}

function absolute(pathOrUrl: string): string {
  if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl;
  return `${SITE_URL}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}

function upsertMeta(attr: "name" | "property", key: string, content: string) {
  const selector = `meta[${attr}="${key}"][data-seo]`;
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    el.setAttribute("data-seo", "");
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function upsertCanonical(href: string) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"][data-seo]');
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    el.setAttribute("data-seo", "");
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

/** Imperatively apply SEO tags. Exposed for the rare non-component caller; most code uses <Seo />. */
export function applySeo({ title, description, path, image, type = "website" }: Omit<SeoProps, "jsonLd">) {
  const url = absolute(path);
  const img = absolute(image ?? DEFAULT_OG_IMAGE);

  document.title = title;
  upsertMeta("name", "description", description);
  upsertCanonical(url);

  upsertMeta("property", "og:site_name", SITE_NAME);
  upsertMeta("property", "og:type", type);
  upsertMeta("property", "og:title", title);
  upsertMeta("property", "og:description", description);
  upsertMeta("property", "og:url", url);
  upsertMeta("property", "og:image", img);

  upsertMeta("name", "twitter:card", "summary_large_image");
  upsertMeta("name", "twitter:title", title);
  upsertMeta("name", "twitter:description", description);
  upsertMeta("name", "twitter:image", img);
}

/** A render-nothing component that manages the document <head> for its route. */
export function Seo({ jsonLd, title, description, path, image, type = "website" }: SeoProps) {
  useEffect(() => {
    applySeo({ title, description, path, image, type });
  }, [title, description, path, image, type]);

  const jsonLdText = jsonLd ? JSON.stringify(jsonLd) : null;
  useEffect(() => {
    if (!jsonLdText) return;
    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.setAttribute("data-seo-jsonld", "");
    script.textContent = jsonLdText;
    document.head.appendChild(script);
    return () => {
      script.remove();
    };
  }, [jsonLdText]);

  return null;
}
