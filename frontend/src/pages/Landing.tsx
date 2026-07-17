import { Link } from "react-router-dom";
import { MarketingFooter, MarketingHeader } from "../components/MarketingChrome";
import { TypeUIPanel } from "../components/TypeUIPanel";
import { PageShell, buttonClassName } from "../components/ui";
import { BoltIcon, CheckIcon, ChevronRightIcon, ShieldIcon } from "../components/icons";
import { UPCOMING, rosterByDomain, type RosterEntry } from "../content/roster";
import { Seo, SITE_URL } from "../lib/seo";

const orgJsonLd = [
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Sydekyks",
    url: SITE_URL,
    logo: `${SITE_URL}/og-cover.png`,
    description: "Specialist AI agents that execute auditable back-office workflows inside Odoo.",
  },
  { "@context": "https://schema.org", "@type": "WebSite", name: "Sydekyks", url: SITE_URL },
];

const HOW_IT_WORKS = [
  {
    icon: BoltIcon,
    step: "01",
    title: "Signal the mission",
    detail: "Upload a document, schedule a sweep, or trigger a run from the work already happening in Odoo.",
  },
  {
    icon: CheckIcon,
    step: "02",
    title: "Run the playbook",
    detail: "A specialist follows a fixed sequence, reads the evidence, and acts directly in your operating system.",
  },
  {
    icon: ShieldIcon,
    step: "03",
    title: "Review the exceptions",
    detail: "Confident work moves forward. Ambiguity reaches a human with the source, reasoning, and next action attached.",
  },
];

const LIVE_COUNT = rosterByDomain().reduce((total, group) => total + group.entries.length, 0);
const UPCOMING_COUNT = UPCOMING.reduce((total, group) => total + group.entries.length, 0);

export default function Landing() {
  return (
    <PageShell>
      <div className="typeui-page">
        <Seo
          title="Sydekyks — AI agents that automate your back office"
          description="Activate specialist AI agents for accounts payable, recruitment and sales—working directly inside Odoo."
          path="/"
          type="website"
          jsonLd={orgJsonLd}
        />
        <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-ink-800 focus:p-3 focus:text-heading">
          Skip to main content
        </a>
        <MarketingHeader />

        <main id="main-content">
          <section className="typeui-grid typeui-scanlines min-h-[42rem] border-b-2 border-ink-600">
            <video className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-15 grayscale contrast-200 brightness-50" autoPlay loop muted playsInline aria-hidden="true">
              <source src="/bground.mp4" type="video/mp4" />
            </video>
            <div className="absolute inset-0 bg-gradient-to-r from-ink-950 via-ink-950/95 to-ink-950/60" />
            <div className="typeui-container relative grid min-h-[42rem] items-center gap-12 py-16 lg:grid-cols-[1fr_22rem] lg:py-24">
              <div>
                <span className="inline-flex rounded-[2px] border-2 border-gold-700 bg-brand-softer px-2 py-1 text-xs font-medium uppercase tracking-[0.4px] text-gold-300">
                  Autonomous work. Human control.
                </span>
                <h1 className="mt-8 max-w-3xl">Your back office just got backup.</h1>
                <p className="mt-8 max-w-[65ch] text-xl">
                  Deploy specialist AI agents that read the work, follow an auditable playbook, and act inside Odoo—without turning your team into prompt engineers.
                </p>
                <div className="mt-10 flex flex-wrap gap-4">
                  <Link to="/login" className={buttonClassName("primary", "px-6 py-3")}>Activate your HQ</Link>
                  <a href="#roster" className={buttonClassName("ghost", "px-6 py-3")}>Meet the roster <ChevronRightIcon className="h-4 w-4" /></a>
                </div>
              </div>
              <aside aria-label="Platform summary" className="rounded-[4px] border-2 border-ink-600 bg-ink-900 p-6 shadow-[var(--shadow-md)]">
                <p className="text-xs font-medium uppercase tracking-[0.4px] text-gold-300">Mission control</p>
                <dl className="mt-8 grid gap-6">
                  <Metric value={String(LIVE_COUNT)} label="Live specialist agents" />
                  <Metric value={String(UPCOMING_COUNT)} label="Agents in the build queue" />
                  <Metric value={String(LIVE_COUNT + UPCOMING_COUNT)} label="Specialists on the roadmap" />
                </dl>
              </aside>
            </div>
          </section>

          <div className="typeui-divider" aria-hidden="true" />

          <section id="roster" className="typeui-section typeui-grid scroll-mt-24">
            <div className="typeui-container">
              <header className="mb-16 max-w-3xl">
                <p className="text-sm font-medium uppercase tracking-[0.4px] text-gold-300">The roster</p>
                <h2 className="mt-4">One expert for every mission.</h2>
                <p className="mt-8 text-xl">Each Sydekyk has a defined job, a visible playbook, and a clear point where judgment returns to your team.</p>
              </header>
              <div className="grid items-start gap-6 lg:grid-cols-3">
                {rosterByDomain().map(({ domain, entries }) => (
                  <section key={domain} aria-labelledby={`domain-${domain}`} className="!bg-ink-900 rounded-[4px] border-2 border-ink-600 p-4 sm:p-6">
                    <div className="mb-6 flex items-center gap-3 border-b-2 border-ink-600 pb-4">
                      <h3 id={`domain-${domain}`} className="text-2xl">{domain}</h3>
                      <span className="h-0.5 flex-1 bg-ink-700" aria-hidden="true" />
                      <span className="rounded-[2px] border-2 border-gold-700 bg-brand-softer px-2 py-1 text-xs font-medium text-gold-300">{entries.length.toString().padStart(2, "0")} live</span>
                    </div>
                    <div className="grid gap-4">
                      {entries.map((entry) => <RosterCard key={entry.slug} entry={entry} />)}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          </section>

          <div className="typeui-divider" aria-hidden="true" />

          <section id="how-it-works" className="typeui-section typeui-grid scroll-mt-24">
            <div className="typeui-container">
              <header className="mb-16 max-w-3xl">
                <p className="text-sm font-medium uppercase tracking-[0.4px] text-gold-300">How it works</p>
                <h2 className="mt-4">Not a chatbot. An operating model.</h2>
                <p className="mt-8 text-xl">Every mission has a trigger, a bounded sequence of work, durable evidence, and a human-safe finish.</p>
              </header>
              <ol className="grid gap-6 md:grid-cols-3">
                {HOW_IT_WORKS.map((item) => (
                  <li key={item.title} className="rounded-[4px] border-2 border-ink-600 bg-ink-900 p-6 shadow-[var(--shadow-xs)]">
                    <div className="flex items-center justify-between gap-4">
                      <span className="grid h-11 w-11 place-items-center rounded-[4px] border-2 border-gold-700 bg-brand-softer text-gold-300"><item.icon className="h-5 w-5" /></span>
                      <span className="text-sm font-medium text-body">{item.step}</span>
                    </div>
                    <h3 className="mt-8 text-2xl">{item.title}</h3>
                    <p className="mt-8">{item.detail}</p>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          <div className="typeui-divider" aria-hidden="true" />

          <section id="upcoming" className="typeui-section">
            <div className="typeui-container">
              <header className="mb-16 grid items-end gap-8 lg:grid-cols-[1fr_auto]">
                <div className="max-w-3xl">
                  <p className="text-sm font-medium uppercase tracking-[0.4px] text-gold-300">Next in queue</p>
                  <h2 className="mt-4">This is only the beginning.</h2>
                  <p className="mt-8 text-xl">The next wave brings specialist backup to finance, recruitment, sales, purchasing, inventory, manufacturing, support, and data quality.</p>
                </div>
                <div className="rounded-[4px] border-2 border-gold-600 bg-brand-softer px-6 py-5 text-right shadow-[var(--shadow-md)]">
                  <strong className="block text-5xl font-bold text-heading">{UPCOMING_COUNT}</strong>
                  <span className="mt-2 block text-sm font-medium uppercase tracking-[0.4px] text-gold-300">more agents coming</span>
                </div>
              </header>
              <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
                {UPCOMING.map(({ domain, entries }, domainIndex) => (
                  <article key={domain} className="rounded-[4px] border-2 border-dashed border-ink-600 bg-ink-900 p-5">
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-xs font-medium text-body">{String(domainIndex + 1).padStart(2, "0")}</span>
                      <span className="rounded-[2px] border-2 border-ink-600 bg-ink-800 px-2 py-1 text-xs font-medium uppercase text-body">{entries.length} queued</span>
                    </div>
                    <h3 className="mt-6 text-xl">{domain}</h3>
                    <ul className="mt-6 grid gap-3">
                      {entries.map((entry) => (
                        <li key={entry.name} className="border-t-2 border-ink-600 pt-3">
                          <span className="block font-medium text-heading">{entry.name}</span>
                          <span className="mt-1 block text-sm text-body">{entry.agent}</span>
                        </li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>
            </div>
          </section>

          <section className="typeui-section typeui-grid border-t-2 border-ink-600">
            <div className="typeui-container text-center">
              <p className="text-sm font-medium uppercase tracking-[0.4px] text-gold-300">Ready when you are</p>
              <h2 className="mx-auto mt-4 max-w-3xl">Give your team a specialist bench.</h2>
              <p className="mx-auto mt-8 max-w-[65ch] text-xl">Activate your HQ, assign the right agents, and keep every mission visible from signal to sign-off.</p>
              <Link to="/login" className={buttonClassName("primary", "mt-10 px-6 py-3")}>Enter your HQ</Link>
            </div>
          </section>
        </main>

        <MarketingFooter />
        <TypeUIPanel />
      </div>
    </PageShell>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="border-t-2 border-ink-600 pt-4">
      <dt className="text-sm text-body">{label}</dt>
      <dd className="mt-1 text-3xl font-bold text-heading">{value}</dd>
    </div>
  );
}

function RosterCard({ entry }: { entry: RosterEntry }) {
  return (
    <Link to={`/sydekyks/${entry.slug}`} className="group grid min-h-40 grid-cols-[7.5rem_1fr] overflow-hidden rounded-[4px] border-2 border-ink-600 bg-ink-950 shadow-[var(--shadow-xs)] transition-colors hover:border-gold-600 hover:bg-ink-800">
      <div className="border-r-2 border-ink-600 bg-ink-950">
        <img src={`/sydekyks/${entry.slug}.png`} alt={`${entry.name}, ${entry.role}`} loading="lazy" className="h-full w-full object-cover object-top" />
      </div>
      <div className="flex min-w-0 flex-col p-4">
        <span className="text-xs font-medium uppercase tracking-[0.4px] text-gold-300">{entry.role}</span>
        <h4 className="agent-name mt-3 text-xl">{entry.name}</h4>
        <p className="mt-4 line-clamp-2 text-sm">{entry.tagline}</p>
        <span className="mt-auto inline-flex items-center gap-2 pt-4 text-sm font-medium text-gold-300">Agent file <ChevronRightIcon className="h-4 w-4" /></span>
      </div>
    </Link>
  );
}
