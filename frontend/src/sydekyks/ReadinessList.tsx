import type { ReadinessItem } from "../lib/api";

/** Shared readiness checklist renderer, used by Decode + Scout settings sections. */
export function ReadinessList({ items }: { items: ReadinessItem[] }) {
  function dot(state: string) {
    return state === "ok" ? "bg-gold-400" : state === "warn" ? "bg-amber-500" : "bg-red-500";
  }
  return (
    <div className="grid gap-2">
      {items.map((it) => (
        <div key={it.key} className="flex items-start gap-2">
          <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dot(it.state)}`} />
          <div className="min-w-0">
            <p className="text-sm text-[#ede6da]">{it.label}</p>
            {it.detail && <p className="text-xs text-[#8a7f6d]">{it.detail}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}
