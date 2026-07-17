import { Link } from "react-router-dom";
import { AgentThumb } from "./AgentThumb";
import { useSydekykLink } from "../lib/useSydekykLink";

/** The shared header for a dashboard insight card: the agent thumb + name + kicker, plus an
 * Odoo-style "smart button" that jumps straight to the agent's page — no detour through the Roster. */
export function AgentCardHeader({ slug, name, kicker }: { slug: string; name: string; kicker: string }) {
  const href = useSydekykLink(slug);
  return (
    <div className="relative flex items-center gap-3">
      <AgentThumb slug={slug} alt={name} />
      <div className="min-w-0">
        <p className="truncate text-base font-bold text-heading">{name}</p>
        <p className="text-xs font-medium uppercase tracking-[0.4px] text-gold-300">{kicker}</p>
      </div>
      {href && (
        <Link
          to={href}
          className="ml-auto inline-flex min-h-11 shrink-0 items-center gap-2 rounded-[4px] border-2 border-ink-600 bg-ink-800 px-3 py-2 text-sm font-medium text-gold-300 transition-colors hover:border-gold-500 hover:bg-ink-700 hover:text-heading"
        >
          Open agent →
        </Link>
      )}
    </div>
  );
}
