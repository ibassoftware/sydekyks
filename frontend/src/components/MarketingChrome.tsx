/** Shared header + footer for the public marketing pages (Landing + per-Sydekyk showcases), so the
 * chrome stays identical and DRY. Reuses the gold ⚡ SYDEKYKS wordmark + Button from the app. */
import { Link } from "react-router-dom";
import { Button } from "./ui";

/** The ⚡ SYDEKYKS wordmark, linking home. */
export function BrandMark() {
  return (
    <Link to="/" className="flex items-center gap-2 text-lg font-bold tracking-wide text-gold-300">
      <span className="text-2xl leading-none drop-shadow-[0_0_10px_rgba(212,168,40,0.5)]">⚡</span>
      SYDEKYKS
    </Link>
  );
}

export function MarketingHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-ink-700/60 bg-ink-950/70 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <BrandMark />
        <nav className="flex items-center gap-3">
          <Link to="/login" className="text-sm font-medium text-[#c9beac] transition-colors hover:text-gold-300">
            Log in
          </Link>
          <Link to="/login">
            <Button>Activate Your HQ</Button>
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="mt-24 border-t border-ink-700 py-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-6 text-center sm:flex-row sm:justify-between sm:text-left">
        <BrandMark />
        <p className="text-xs text-[#7a6f5d]">
          © {new Date().getFullYear()} Sydekyks. Every hero needs backup.
        </p>
      </div>
    </footer>
  );
}
