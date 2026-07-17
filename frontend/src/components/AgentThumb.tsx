/** A small rounded avatar thumbnail for an agent, from its public avatar (/sydekyks/<slug>.png).
 * Used on the dashboard insight cards so each agent's value block is instantly recognizable. */
export function AgentThumb({ slug, alt, size = 40 }: { slug: string; alt: string; size?: number }) {
  return (
    <span
      className="inline-block shrink-0 overflow-hidden rounded-[4px] border-2 border-ink-600 bg-ink-950 shadow-[var(--shadow-xs)]"
      style={{ width: size, height: size }}
    >
      <img src={`/sydekyks/${slug}.png`} alt={alt} className="h-full w-full object-cover object-top" />
    </span>
  );
}
