import { Link, Navigate, useParams } from "react-router-dom";
import { MarketingFooter, MarketingHeader } from "../components/MarketingChrome";
import { TypeUIPanel } from "../components/TypeUIPanel";
import { PageShell, buttonClassName } from "../components/ui";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon } from "../components/icons";
import { rosterBySlug } from "../content/roster";
import { Seo, SITE_URL } from "../lib/seo";

export default function SydekykShowcase() {
  const { slug } = useParams<{ slug: string }>();
  const entry = slug ? rosterBySlug[slug] : undefined;
  if (!entry) return <Navigate to="/" replace />;

  const path = `/sydekyks/${entry.slug}`;
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: `${entry.name} - Sydekyk`,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      description: entry.summary,
      image: `${SITE_URL}/sydekyks/${entry.slug}.png`,
      url: `${SITE_URL}${path}`,
    },
  ];

  return (
    <PageShell>
      <div className="typeui-page">
        <Seo title={`${entry.name} - ${entry.tagline.replace(/\.$/, "")} · Sydekyks`} description={entry.tagline} path={path} image={`/sydekyks/${entry.slug}.png`} type="article" jsonLd={jsonLd} />
        <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-ink-800 focus:p-3 focus:text-heading">Skip to main content</a>
        <MarketingHeader />

        <main id="main-content">
          <section className="typeui-section typeui-grid border-b-2 border-ink-600">
            <div className="typeui-container">
              <Link to="/#roster" className="group mb-12 inline-flex min-h-11 items-center gap-2 font-medium text-gold-300 hover:text-heading">
                <ChevronLeftIcon className="fx-arrow-back h-4 w-4" /> Back to roster
              </Link>
              <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]">
                <article className="max-w-3xl">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="rounded-[2px] border-2 border-gold-700 bg-brand-softer px-2 py-1 text-xs font-medium uppercase tracking-[0.4px] text-gold-300">{entry.domain}</span>
                    <span className="rounded-[2px] border-2 border-ink-600 bg-ink-800 px-2 py-1 text-xs font-medium uppercase tracking-[0.4px] text-body">Live agent</span>
                  </div>
                  <h1 className="mt-6">{entry.name}</h1>
                  <p className="mt-8 max-w-[65ch] text-xl text-heading">{entry.tagline}</p>
                  <p className="mt-6 max-w-[65ch]">{entry.summary}</p>
                  <div className="mt-10 flex flex-wrap gap-4">
                    <Link to="/login" className={buttonClassName("primary", "px-6 py-3")}>Activate {entry.name}</Link>
                    <a href="#playbook" className={buttonClassName("ghost", "group px-6 py-3")}>Read the playbook <ChevronRightIcon className="fx-arrow h-4 w-4" /></a>
                  </div>
                </article>

                <figure className="fx-figure mx-auto w-full max-w-96 overflow-hidden rounded-[4px] border-2 border-ink-600 bg-ink-900 shadow-[var(--shadow-md)]">
                  <img src={`/sydekyks/${entry.slug}.png`} alt={`${entry.name}, ${entry.role}`} className="block h-auto w-full" />
                  <figcaption className="flex items-center justify-between gap-4 border-t-2 border-ink-600 px-4 py-3">
                    <span className="font-medium text-heading">{entry.name}</span>
                    <span className="text-sm text-body">{entry.role}</span>
                  </figcaption>
                </figure>
              </div>

              <aside aria-label={`${entry.name} agent brief`} className="mt-16 grid gap-6 lg:grid-cols-[1.4fr_1fr_1fr]">
                <BriefBlock index="01" title="Mission" detail={entry.tagline} />
                <BriefBlock index="02" title="Operating mode" detail={`A ${entry.role.toLowerCase()} specialist with durable mission history and explicit human review points.`} />
                <BriefBlock index="03" title="System of action" detail="Reads and writes real Odoo records, with every consequential step captured for review." />
              </aside>
            </div>
          </section>

          <div className="typeui-divider" aria-hidden="true" />

          <section id="playbook" className="typeui-section typeui-grid scroll-mt-24">
            <div className="typeui-container">
              <header className="fx-reveal mb-16 max-w-3xl">
                <p className="text-sm font-medium uppercase tracking-[0.4px] text-gold-300">Playbook</p>
                <h2 className="mt-4">From signal to sign-off.</h2>
                <p className="mt-8 text-xl">Every {entry.name} mission follows the same legible sequence. No invisible hand-waving.</p>
              </header>
              <ol className="grid gap-6 sm:grid-cols-2">
                {entry.howItWorks.map((step, index) => (
                  <li key={step.title} className="fx-reveal rounded-[4px] border-2 border-ink-600 bg-ink-900 p-6 shadow-[var(--shadow-xs)]">
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-sm font-medium text-body">{String(index + 1).padStart(2, "0")}</span>
                      <span className="h-0.5 flex-1 bg-ink-700" aria-hidden="true" />
                    </div>
                    <h3 className="mt-8 text-2xl">{step.title}</h3>
                    <p className="mt-8">{step.detail}</p>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          <div className="typeui-divider" aria-hidden="true" />

          <section className="typeui-section">
            <div className="typeui-container grid gap-12 lg:grid-cols-[.75fr_1.25fr]">
              <header className="fx-reveal">
                <p className="text-sm font-medium uppercase tracking-[0.4px] text-gold-300">Capabilities</p>
                <h2 className="mt-4">Built for the whole job.</h2>
                <p className="mt-8">A bounded set of capabilities, applied consistently and backed by evidence.</p>
              </header>
              <ul className="grid gap-4">
                {entry.capabilities.map((capability) => (
                  <li key={capability} className="fx-reveal flex items-start gap-4 rounded-[4px] border-2 border-ink-600 bg-ink-900 p-5">
                    <CheckIcon className="mt-1 h-5 w-5 shrink-0 text-gold-300" />
                    <span className="text-body">{capability}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="typeui-section typeui-grid border-t-2 border-ink-600">
            <div className="fx-reveal typeui-container text-center">
              <p className="text-sm font-medium uppercase tracking-[0.4px] text-gold-300">Deploy {entry.name}</p>
              <h2 className="mx-auto mt-4 max-w-3xl">Put a specialist on the mission.</h2>
              <p className="mx-auto mt-8 max-w-[65ch] text-xl">Activate {entry.name} in your HQ, connect the right Odoo workspace, and keep every run visible.</p>
              <div className="mt-10 flex flex-wrap justify-center gap-4">
                <Link to="/login" className={buttonClassName("primary", "px-6 py-3")}>Enter your HQ</Link>
                <Link to="/#roster" className={buttonClassName("ghost", "px-6 py-3")}>Explore the roster</Link>
              </div>
            </div>
          </section>
        </main>

        <MarketingFooter />
        <TypeUIPanel />
      </div>
    </PageShell>
  );
}

function BriefBlock({ index, title, detail }: { index: string; title: string; detail: string }) {
  return (
    <section className="fx-reveal !bg-ink-900 rounded-[4px] border-2 border-ink-600 p-6 shadow-[var(--shadow-xs)]">
      <div className="flex items-center gap-4"><span className="text-sm font-medium text-gold-300">{index}</span><span className="h-0.5 flex-1 bg-ink-700" aria-hidden="true" /></div>
      <h2 className="mt-6 text-2xl">{title}</h2>
      <p className="mt-8 text-sm">{detail}</p>
    </section>
  );
}
