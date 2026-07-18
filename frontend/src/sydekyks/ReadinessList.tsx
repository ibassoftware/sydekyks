import { Link } from "react-router-dom";
import { Badge } from "../components/ui";
import type { ReadinessItem, ReadinessState } from "../lib/api";

const STATE: Record<ReadinessState, { dot: string; label: string; tone: "success" | "warning" | "danger" }> = {
  ok: { dot: "bg-success", label: "Good to go", tone: "success" },
  warn: { dot: "bg-warning", label: "Needs attention", tone: "warning" },
  blocked: { dot: "bg-danger", label: "Blocked", tone: "danger" },
};

/** Shared readiness checklist for every Sydekyk settings screen. */
export function ReadinessList({ items }: { items: ReadinessItem[] }) {
  return (
    <ul className="overflow-hidden rounded-[4px] border-2 border-ink-600 bg-ink-900 shadow-[var(--shadow-xs)]">
      {items.map((it) => (
        <li key={it.key} className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-ink-600 p-4 last:border-b-0">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <span aria-hidden="true" className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${STATE[it.state].dot}`} />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-heading">{it.label}</p>
              {it.detail && <p className="mt-1 text-xs leading-5 text-body">{it.detail}</p>}
            </div>
          </div>
          <div className="ml-5 flex shrink-0 flex-wrap items-center gap-2 sm:ml-0">
            <Badge tone={STATE[it.state].tone}>{STATE[it.state].label}</Badge>
            {it.action_label && it.action_href && it.state !== "ok" && (
              it.action_href.startsWith("/") ? (
                <Link to={it.action_href} className="inline-flex min-h-11 items-center text-sm font-medium text-gold-300 underline hover:text-heading hover:no-underline">
                  {it.action_label}
                </Link>
              ) : (
                <a href={it.action_href} className="inline-flex min-h-11 items-center text-sm font-medium text-gold-300 underline hover:text-heading hover:no-underline">
                  {it.action_label}
                </a>
              )
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
