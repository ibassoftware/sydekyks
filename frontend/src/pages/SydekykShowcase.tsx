import { Link, Navigate, useParams } from "react-router-dom";
import { Button, PageShell } from "../components/ui";
import { MarketingHeader, MarketingFooter } from "../components/MarketingChrome";
import { Seo, SITE_URL } from "../lib/seo";
import { rosterBySlug } from "../content/roster";
import { CheckIcon, ChevronLeftIcon } from "../components/icons";

export default function SydekykShowcase() {
  const { slug } = useParams<{ slug: string }>();
  const entry = slug ? rosterBySlug[slug] : undefined;

  // Unknown slug → back to the landing page (mirrors App.tsx's catch-all behaviour).
  if (!entry) return <Navigate to="/" replace />;

  const path = `/sydekyks/${entry.slug}`;
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: `${entry.name} — Sydekyk`,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      description: entry.summary,
      image: `${SITE_URL}/sydekyks/${entry.slug}.png`,
      url: `${SITE_URL}${path}`,
      offers: { "@type": "Offer", category: "SaaS" },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
        { "@type": "ListItem", position: 2, name: "Roster", item: `${SITE_URL}/#roster` },
        { "@type": "ListItem", position: 3, name: entry.name, item: `${SITE_URL}${path}` },
      ],
    },
  ];

  const isHr = entry.accent === "hr";
  const accentText = isHr ? "text-blue-300" : "text-gold-400";
  const accentGlow = isHr
    ? "shadow-[0_0_40px_-8px_rgba(96,165,250,0.35)]"
    : "shadow-[0_0_40px_-8px_rgba(212,168,40,0.4)]";

  return (
    <PageShell>
      <Seo
        title={`${entry.name} — ${entry.tagline.replace(/\.$/, "")} · Sydekyks`}
        description={entry.tagline}
        path={path}
        image={`/sydekyks/${entry.slug}.png`}
        type="article"
        jsonLd={jsonLd}
      />
      <MarketingHeader />

      <main className="mx-auto max-w-6xl px-6">
        <Link
          to="/#roster"
          className="mt-8 inline-flex items-center gap-1 text-sm font-medium text-[#b9ad98] transition-colors hover:text-gold-300"
        >
          <ChevronLeftIcon className="h-4 w-4" /> Back to the Roster
        </Link>

        {/* Hero */}
        <section className="grid items-center gap-10 py-10 md:grid-cols-[minmax(0,1fr)_20rem] md:py-14">
          <div>
            <p className={`text-xs font-semibold uppercase tracking-[0.2em] ${accentText}`}>
              {entry.domain} · {entry.role}
            </p>
            <h1 className="mt-3 text-5xl font-bold leading-tight text-[#f5eee0] md:text-6xl">{entry.name}</h1>
            <p className="mt-5 max-w-xl text-lg text-[#d8cdb9]">{entry.tagline}</p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Link to="/login">
                <Button className="px-8 py-3 text-base">Activate {entry.name}</Button>
              </Link>
              <a href="#how">
                <Button variant="ghost" className="px-8 py-3 text-base">
                  See how it works
                </Button>
              </a>
            </div>
          </div>
          <div
            className={`relative overflow-hidden rounded-2xl border border-ink-600 bg-ink-950 ${accentGlow}`}
          >
            <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_50%_15%,_var(--color-gold-600)_0%,_transparent_60%)] opacity-25" />
            <img
              src={`/sydekyks/${entry.slug}.png`}
              alt={`${entry.name} — ${entry.role} Sydekyk`}
              className="relative z-10 aspect-[912/1199] w-full object-cover object-top"
            />
          </div>
        </section>

        {/* What it does */}
        <section className="border-t border-ink-700 py-14">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-gold-500">What it does</h2>
          <p className="mt-4 max-w-3xl text-lg leading-relaxed text-[#c9beac]">{entry.summary}</p>
        </section>

        {/* How it works */}
        <section id="how" className="scroll-mt-24 border-t border-ink-700 py-14">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-gold-500">How it works</h2>
          <p className="mt-2 text-[#b9ad98]">Every Mission follows the same auditable Playbook.</p>
          <ol className="mt-8 grid gap-4 sm:grid-cols-2">
            {entry.howItWorks.map((step, i) => (
              <li key={step.title} className="rounded-xl border border-ink-700 bg-ink-900/50 p-5">
                <div className="flex items-center gap-3">
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gold-500/10 text-sm font-bold ${accentText}`}
                  >
                    {i + 1}
                  </span>
                  <p className="text-base font-semibold text-[#f5eee0]">{step.title}</p>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-[#b9ad98]">{step.detail}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Capabilities */}
        <section className="border-t border-ink-700 py-14">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-gold-500">Key capabilities</h2>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2">
            {entry.capabilities.map((cap) => (
              <li key={cap} className="flex items-start gap-3">
                <CheckIcon className={`mt-0.5 h-5 w-5 shrink-0 ${accentText}`} />
                <span className="text-[#d8cdb9]">{cap}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Demo */}
        <section className="border-t border-ink-700 py-14">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-gold-500">See it in action</h2>
          <div className="mt-6 flex aspect-video w-full items-center justify-center rounded-2xl border border-dashed border-ink-600 bg-gradient-to-b from-ink-800/60 to-ink-950">
            <div className="text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-gold-700/50 bg-ink-900/70 text-2xl text-gold-400">
                ▶
              </div>
              <p className="mt-4 text-sm font-semibold text-[#d8cdb9]">Demo coming soon</p>
              <p className="mt-1 text-xs text-[#7a6f5d]">
                A short walkthrough of {entry.name} on a real Mission.
              </p>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-12 text-center">
          <div className="relative mx-auto max-w-2xl overflow-hidden rounded-2xl border border-gold-700/40 bg-gradient-to-br from-ink-800 via-ink-900 to-ink-950 px-8 py-14 shadow-xl">
            <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-gold-500/10 blur-3xl" />
            <h2 className="relative text-2xl font-bold text-[#f5eee0]">Put {entry.name} to work</h2>
            <p className="relative mx-auto mt-3 max-w-md text-[#b9ad98]">
              Activate {entry.name} in your HQ, or explore the rest of the Roster.
            </p>
            <div className="relative mt-7 flex flex-wrap justify-center gap-4">
              <Link to="/login">
                <Button className="px-8 py-3 text-base">Activate Your HQ</Button>
              </Link>
              <Link to="/#roster">
                <Button variant="ghost" className="px-8 py-3 text-base">
                  Back to the Roster
                </Button>
              </Link>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </PageShell>
  );
}
