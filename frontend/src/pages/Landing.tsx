import { Link } from "react-router-dom";
import { Button, PageShell } from "../components/ui";
import { MarketingHeader, MarketingFooter } from "../components/MarketingChrome";
import { Seo, SITE_URL } from "../lib/seo";
import { ROSTER, rosterByDomain, type RosterEntry } from "../content/roster";
import { BoltIcon, CheckIcon, ChevronRightIcon, ShieldIcon } from "../components/icons";

const orgJsonLd = [
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Sydekyks",
    url: SITE_URL,
    logo: `${SITE_URL}/og-cover.png`,
    description:
      "Sydekyks are premium AI agents that automate real back-office work — accounts payable, " +
      "recruitment and sales — acting directly inside the tools your team already runs.",
  },
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Sydekyks",
    url: SITE_URL,
  },
];

export default function Landing() {
  return (
    <PageShell>
      <Seo
        title="Sydekyks — AI agents that automate your back office"
        description="Activate a roster of premium AI Sydekyks that automate accounts payable, recruitment and sales — acting directly inside your Odoo. Every hero needs backup."
        path="/"
        type="website"
        jsonLd={orgJsonLd}
      />
      <MarketingHeader />

      <main className="mx-auto max-w-6xl px-6">
        {/* Hero */}
        <section className="relative flex flex-col items-center overflow-hidden py-24 text-center sm:py-28">
          <div className="pointer-events-none absolute -top-24 left-1/2 h-96 w-[42rem] max-w-[90vw] -translate-x-1/2 rounded-full bg-gold-500/10 blur-3xl" />
          <span className="relative mb-6 rounded-full border border-gold-700/50 bg-ink-900/60 px-4 py-1 text-xs font-semibold uppercase tracking-widest text-gold-400">
            Every hero needs backup
          </span>
          <h1 className="relative max-w-3xl text-5xl font-bold leading-tight text-[#f5eee0] md:text-6xl">
            Activate AI <span className="text-gold-400">Sydekyks</span> for your entire team
          </h1>
          <p className="relative mt-6 max-w-2xl text-lg text-[#b9ad98]">
            Sydekyks are premium AI agents that take the repetitive back-office work off your team's
            plate — reading the documents, catching what humans miss, and acting directly inside the
            tools you already run. Live in your Odoo today, reaching further tomorrow.
          </p>
          <div className="relative mt-10 flex flex-wrap justify-center gap-4">
            <Link to="/login">
              <Button className="px-8 py-3 text-base">Enter Your HQ</Button>
            </Link>
            <a href="#roster">
              <Button variant="ghost" className="px-8 py-3 text-base">
                Meet the Roster
              </Button>
            </a>
          </div>
          <p className="relative mt-8 text-xs font-medium uppercase tracking-widest text-[#7a6f5d]">
            {ROSTER.length} Sydekyks · Sales · Accounting · HR · Works inside Odoo
          </p>
        </section>

        {/* Roster */}
        <section id="roster" className="scroll-mt-24 py-12">
          <div className="text-center">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-gold-500">The Roster</h2>
            <p className="mx-auto mt-2 max-w-xl text-[#b9ad98]">
              A growing lineup of specialist Sydekyks, each an expert at one job — ready for any HQ to
              activate.
            </p>
          </div>

          {rosterByDomain().map(({ domain, entries }) => (
            <div key={domain} className="mt-14 first:mt-12">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-500">{domain}</p>
              <div className="mt-5 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {entries.map((entry) => (
                  <RosterCard key={entry.slug} entry={entry} />
                ))}
              </div>
            </div>
          ))}
        </section>

        {/* How Sydekyks work */}
        <section className="py-20">
          <div className="text-center">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-gold-500">
              How Sydekyks work
            </h2>
            <p className="mx-auto mt-2 max-w-xl text-[#b9ad98]">
              Not another chatbot. Each Sydekyk is a specialist that does the job end to end.
            </p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {HOW_IT_WORKS.map((item) => (
              <div
                key={item.title}
                className="rounded-xl border border-ink-600 bg-gradient-to-b from-ink-800 to-ink-900 p-6 shadow-xl"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-gold-500/10 text-gold-400">
                  <item.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 text-lg font-semibold text-[#f5eee0]">{item.title}</h3>
                <p className="mt-2 text-sm text-[#b9ad98]">{item.detail}</p>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="py-12 text-center">
          <div className="relative mx-auto max-w-2xl overflow-hidden rounded-2xl border border-gold-700/40 bg-gradient-to-br from-ink-800 via-ink-900 to-ink-950 px-8 py-14 shadow-xl">
            <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-gold-500/10 blur-3xl" />
            <h2 className="relative text-2xl font-bold text-[#f5eee0]">Ready to build your headquarters?</h2>
            <p className="relative mx-auto mt-3 max-w-md text-[#b9ad98]">
              Sign in to activate Sydekyks for your team, or ask your Commander for an invite.
            </p>
            <Link to="/login" className="relative mt-7 inline-block">
              <Button className="px-8 py-3 text-base">Activate Your HQ</Button>
            </Link>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </PageShell>
  );
}

const HOW_IT_WORKS = [
  {
    icon: BoltIcon,
    title: "Runs a Playbook",
    detail:
      "Each Sydekyk follows a fixed, auditable sequence of steps — no prompt-wrangling, no guesswork. You can see exactly what it did on every Mission.",
  },
  {
    icon: CheckIcon,
    title: "Acts in your tools",
    detail:
      "They don't just chat. Sydekyks read and write real records in the stack you already run — creating bills, filling applicants, drafting follow-ups in Odoo today.",
  },
  {
    icon: ShieldIcon,
    title: "Escalates the exceptions",
    detail:
      "Confident work gets done automatically; anything doubtful is handed to a human reviewer with the evidence attached — so nothing slips and nothing is blindly trusted.",
  },
];

function RosterCard({ entry }: { entry: RosterEntry }) {
  const glow =
    entry.accent === "hr"
      ? "hover:border-blue-400/50 hover:shadow-[0_0_30px_-8px_rgba(96,165,250,0.45)]"
      : "hover:border-gold-500/60 hover:shadow-[0_0_30px_-8px_rgba(212,168,40,0.5)]";
  return (
    <Link
      to={`/sydekyks/${entry.slug}`}
      className={`group relative block overflow-hidden rounded-xl border border-ink-600 bg-ink-950 shadow-xl transition-transform duration-300 hover:-translate-y-1 ${glow}`}
    >
      <div className="relative aspect-[912/1199] w-full overflow-hidden">
        <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_50%_20%,_var(--color-gold-600)_0%,_transparent_65%)] opacity-25 transition-opacity duration-300 group-hover:opacity-40" />
        <img
          src={`/sydekyks/${entry.slug}.png`}
          alt={`${entry.name} — ${entry.role} Sydekyk`}
          loading="lazy"
          className="relative z-10 h-full w-full object-cover object-top transition-transform duration-500 group-hover:scale-105"
        />
        {/* readability scrim */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-3/4 bg-gradient-to-t from-ink-950 via-ink-950/85 to-transparent" />

        <div className="absolute inset-x-0 bottom-0 z-30 p-5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gold-400/90">{entry.role}</p>
          <h3 className="mt-1 text-xl font-bold text-[#f5eee0] [text-shadow:0_2px_10px_rgba(0,0,0,0.8)]">
            {entry.name}
          </h3>
          <p className="mt-1.5 line-clamp-2 text-sm text-[#d8cdb9]">{entry.tagline}</p>
          <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-gold-400 transition-transform duration-300 group-hover:translate-x-0.5">
            Meet {entry.name}
            <ChevronRightIcon className="h-4 w-4" />
          </span>
        </div>
      </div>
    </Link>
  );
}
