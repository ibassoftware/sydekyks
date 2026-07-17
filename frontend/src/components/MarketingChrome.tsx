import { Link } from "react-router-dom";
import { Button } from "./ui";

export function BrandMark() {
  return (
    <Link to="/" className="flex min-h-11 items-center gap-3 text-lg font-bold uppercase tracking-[0.16em] text-heading">
      <span aria-hidden="true" className="grid h-8 w-8 place-items-center rounded-[4px] border-2 border-gold-500 bg-ink-800 text-gold-400">S</span>
      <span>Sydekyks</span>
    </Link>
  );
}

export function MarketingHeader() {
  return (
    <header className="sticky top-0 z-40 border-b-2 border-ink-600 bg-ink-950/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-6 py-3">
        <BrandMark />
        <nav aria-label="Primary" className="flex items-center gap-4">
          <a href="/#roster" className="hidden min-h-11 items-center text-sm font-medium text-body hover:text-heading sm:flex">
            Roster
          </a>
          <a href="/#how-it-works" className="hidden min-h-11 items-center text-sm font-medium text-body hover:text-heading md:flex">
            How it works
          </a>
          <Link to="/login" className="hidden min-h-11 items-center text-sm font-medium text-body hover:text-heading sm:flex">
            Log in
          </Link>
          <Link to="/login">
            <Button>Enter HQ</Button>
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="border-t-2 border-ink-600 bg-ink-900 py-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-6 text-center sm:flex-row sm:justify-between sm:text-left">
        <BrandMark />
        <p className="text-sm text-body">
          © {new Date().getFullYear()} Sydekyks. Every hero needs backup.
        </p>
      </div>
    </footer>
  );
}
