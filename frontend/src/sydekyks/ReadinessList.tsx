import { Link } from "react-router-dom";
import { Badge } from "../components/ui";
import type { ReadinessItem, ReadinessState } from "../lib/api";

const STATE: Record<ReadinessState, { badge: string; label: string; tone: "success" | "warning" | "danger" }> = {
  ok: { badge: "border-success bg-success text-ink-950", label: "Done", tone: "success" },
  warn: { badge: "border-warning text-warning", label: "To do", tone: "warning" },
  blocked: { badge: "border-danger text-danger", label: "Required", tone: "danger" },
};

/** Shared, guided setup checklist for every Sydekyk settings screen — rendered as numbered steps. */
export function ReadinessList({ items }: { items: ReadinessItem[] }) {
  return (
    <ol className="overflow-hidden rounded-[4px] border-2 border-ink-600 bg-ink-900 shadow-[var(--shadow-xs)]">
      {items.map((it, i) => {
        const st = STATE[it.state];
        return (
          <li key={it.key} className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-ink-600 p-4 last:border-b-0">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <span
                aria-hidden="true"
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold tabular-nums ${st.badge}`}
              >
                {it.state === "ok" ? "✓" : i + 1}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-heading">{it.label}</p>
                {it.detail && <p className="mt-1 text-xs leading-5 text-body">{it.detail}</p>}
              </div>
            </div>
            <div className="ml-9 flex shrink-0 flex-wrap items-center gap-2 sm:ml-0">
              <Badge tone={st.tone}>{st.label}</Badge>
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
        );
      })}
    </ol>
  );
}
