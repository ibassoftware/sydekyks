/** A small rounded avatar thumbnail for an agent, from its public avatar (/sydekyks/<slug>.png).
 * Used on the dashboard insight cards so each agent's value block is instantly recognizable. */
export function AgentThumb({ slug, alt, size = 40 }: { slug: string; alt: string; size?: number }) {
  return (
    <span
      className="inline-block shrink-0 overflow-hidden rounded-lg border border-gold-600/30 bg-ink-950 shadow-[0_0_10px_rgba(212,168,40,0.15)]"
      style={{ width: size, height: size }}
    >
      <img src={`/sydekyks/${slug}.png`} alt={alt} className="h-full w-full object-cover object-top" />
    </span>
  );
}
