import { Link } from "react-router-dom";
import { Button, Card, PageShell } from "../components/ui";

const roster = [
  { name: "Insight", power: "Research & Analysis", blurb: "Digs through documents and data to surface the answer you actually need." },
  { name: "Scribe", power: "Writing & Editing", blurb: "Drafts, polishes, and reformats copy in your team's voice." },
  { name: "Sentinel", power: "Support & Triage", blurb: "Watches your queues and routes issues before they escalate." },
];

export default function Landing() {
  return (
    <PageShell>
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2 text-lg font-bold tracking-wide text-gold-300">
          <span className="text-2xl">⚡</span> SYDEKYKS
        </div>
        <nav className="flex items-center gap-3">
          <Link to="/login" className="text-sm font-medium text-[#c9beac] hover:text-gold-300">
            Log in
          </Link>
          <Link to="/login">
            <Button>Activate Your HQ</Button>
          </Link>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-6">
        <section className="flex flex-col items-center py-24 text-center">
          <span className="mb-5 rounded-full border border-gold-700/50 bg-ink-900/60 px-4 py-1 text-xs font-semibold uppercase tracking-widest text-gold-400">
            Every hero needs backup
          </span>
          <h1 className="max-w-3xl text-5xl font-bold leading-tight text-[#f5eee0] md:text-6xl">
            Activate AI <span className="text-gold-400">Sydekyks</span> for your entire team
          </h1>
          <p className="mt-6 max-w-xl text-lg text-[#b9ad98]">
            Sydekyks gives every tenant a roster of premium AI agents — chat assistants and automated
            workflows — ready to deploy, plus exclusives built just for your HQ.
          </p>
          <div className="mt-10 flex gap-4">
            <Link to="/login">
              <Button className="px-8 py-3 text-base">Enter Your HQ</Button>
            </Link>
            <a href="#roster">
              <Button variant="ghost" className="px-8 py-3 text-base">
                View the Roster
              </Button>
            </a>
          </div>
        </section>

        <section id="roster" className="py-16">
          <h2 className="text-center text-sm font-semibold uppercase tracking-widest text-gold-500">
            The Roster
          </h2>
          <p className="mx-auto mt-2 max-w-lg text-center text-[#b9ad98]">
            A growing lineup of shared Sydekyks, ready for any HQ to activate.
          </p>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {roster.map((s) => (
              <Card key={s.name} className="p-6">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-br from-gold-400 to-gold-700 text-xl font-bold text-ink-950">
                  {s.name.charAt(0)}
                </div>
                <h3 className="text-lg font-semibold text-[#f5eee0]">{s.name}</h3>
                <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-gold-500">{s.power}</p>
                <p className="mt-3 text-sm text-[#b9ad98]">{s.blurb}</p>
              </Card>
            ))}
          </div>
        </section>

        <section className="py-20 text-center">
          <Card className="mx-auto max-w-2xl px-8 py-12">
            <h2 className="text-2xl font-bold text-[#f5eee0]">Ready to build your headquarters?</h2>
            <p className="mt-3 text-[#b9ad98]">
              Sign in to activate Sydekyks for your team, or ask your Commander for an invite.
            </p>
            <Link to="/login" className="mt-6 inline-block">
              <Button className="px-8 py-3 text-base">Log In</Button>
            </Link>
          </Card>
        </section>
      </main>

      <footer className="border-t border-ink-700 py-8 text-center text-xs text-[#7a6f5d]">
        © {new Date().getFullYear()} Sydekyks. Every hero needs backup.
      </footer>
    </PageShell>
  );
}
