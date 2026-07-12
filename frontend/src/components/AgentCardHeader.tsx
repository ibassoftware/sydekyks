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
        <p className="truncate text-sm font-bold text-[#f5eee0]">{name}</p>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-gold-500">{kicker}</p>
      </div>
      {href && (
        <Link
          to={href}
          className="ml-auto shrink-0 inline-flex items-center gap-1 rounded-lg border border-ink-600 bg-ink-800/60 px-3 py-1.5 text-xs font-semibold text-gold-300 transition-colors hover:border-gold-500/60 hover:bg-ink-700 hover:text-gold-200"
        >
          Open agent →
        </Link>
      )}
    </div>
  );
}
