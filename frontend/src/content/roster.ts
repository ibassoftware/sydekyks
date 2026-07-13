/** Public marketing copy for the Roster — the single source of truth for the landing page and every
 * per-Sydekyk showcase sub-page. Kept deliberately self-contained (no API, no imports from the authed
 * app) so it renders on the unauthenticated marketing routes and stays out of the app bundle.
 *
 * Copy is authored from each Sydekyk's authoritative tagline/description in
 * `backend/app/seed.py` (`_ROSTER_SYDEKYKS`). Group labels + order mirror the in-app roster
 * grouping (`FUNCTION_GROUPS` in `src/sydekyks/registry.tsx`) so naming stays consistent. */

export type RosterSlug = "nudge" | "ledger" | "mirror" | "shield" | "decode" | "scout";

/** Business function — matches the in-app `FunctionGroup` labels (Sales · Accounting · HR). */
export type Domain = "Sales" | "Accounting" | "HR";

export interface HowItWorksStep {
  title: string;
  detail: string;
}

export interface RosterEntry {
  slug: RosterSlug;
  name: string;
  /** The one-line tagline (verbatim from seed.py). */
  tagline: string;
  domain: Domain;
  /** A short role label shown under the name, e.g. "Accounts-payable automation". */
  role: string;
  /** The narrative "what it does" paragraph (trimmed from the seed description). */
  summary: string;
  /** 3–5 headline capabilities. */
  capabilities: string[];
  /** The 3–4 step "playbook" of how the Sydekyk works. */
  howItWorks: HowItWorksStep[];
  /** Visual accent — HR Sydekyks get a cool tint (mirrors the registry's `domain: "hr"` convention);
   * everything else rides the signature gold. */
  accent: "gold" | "hr";
}

/** Ordered to match the in-app roster grouping: Sales, then Accounting, then HR. */
export const ROSTER: RosterEntry[] = [
  {
    slug: "nudge",
    name: "Nudge",
    tagline: "Your sales follow-up sidekick — no opportunity goes cold on your watch.",
    domain: "Sales",
    role: "Pipeline follow-ups",
    summary:
      "Nudge watches your Odoo pipeline for open opportunities that have gone quiet and drafts the " +
      "follow-up before the deal cools. It measures silence per stage, reads the real thread history, " +
      "and writes a context-aware message that references the last exchange — never a generic “just " +
      "checking in”. It hands each draft to the salesperson, ranked by revenue at risk.",
    capabilities: [
      "Measures silence per pipeline stage — fresh leads get less rope than late-stage deals",
      "Reads each deal's real conversation history for context",
      "Drafts a specific follow-up that references the last exchange",
      "Ranks the queue by revenue at risk",
      "Remembers deals you've paused, so it never nags a deal that's legitimately quiet",
    ],
    howItWorks: [
      { title: "Sweep", detail: "Watches your Odoo pipeline for opportunities that have gone quiet." },
      { title: "Read", detail: "Reads each deal's stage and real conversation history." },
      { title: "Draft", detail: "Writes a context-aware follow-up — never a generic “just checking in”." },
      { title: "Hand off", detail: "Creates a To-Do and logs the draft to the chatter for the rep to edit and send." },
    ],
    accent: "gold",
  },
  {
    slug: "ledger",
    name: "Ledger",
    tagline: "Your accounts-payable sidekick — turns vendor bills into Odoo entries.",
    domain: "Accounting",
    role: "Accounts-payable automation",
    summary:
      "Ledger turns the vendor bills you upload or email in into Odoo vendor bills — automatically. " +
      "It reads each bill with AI, pulls out the vendor, dates, line items, tax and totals, and " +
      "matches them to your real Odoo setup. It creates the bill with the original document attached, " +
      "posts it when it's confident, and flags anything that needs a human.",
    capabilities: [
      "Reads PDFs and photos of bills with vision AI",
      "Extracts vendor, dates, line items, tax and totals",
      "Matches to your real Odoo currency, tax and expense accounts",
      "Creates and posts confident bills with the original attached",
      "Flags duplicates, missing tax rates, or unfamiliar vendors",
    ],
    howItWorks: [
      { title: "Capture", detail: "Upload or email a bill, or let Ledger pull it straight from Odoo." },
      { title: "Read", detail: "Vision AI extracts every field — even from a phone photo." },
      { title: "Match", detail: "Line items map to your Odoo accounts, tax and currency." },
      { title: "File", detail: "Ledger creates and posts the bill, or flags it for a human to check." },
    ],
    accent: "gold",
  },
  {
    slug: "mirror",
    name: "Mirror",
    tagline: "Your accounts-payable watchdog — catches duplicate vendor bills before you pay twice.",
    domain: "Accounting",
    role: "Duplicate-bill detection",
    summary:
      "Mirror scans your Odoo vendor bills and flags likely duplicates before they get paid twice. " +
      "It matches on the invoice reference, on the same vendor + amount + date even when the reference " +
      "differs, and across split vendor records that share a Tax ID or bank account — and uses AI to " +
      "confirm resubmitted invoices by their line items.",
    capabilities: [
      "Matches on invoice reference across every bill",
      "Catches same vendor + amount + date even when the reference differs",
      "Spots split vendor records sharing a Tax ID or bank account",
      "Uses AI to confirm resubmitted invoices by their line items",
      "Learns legitimate recurring bills (rent, subscriptions) so it stops nagging",
    ],
    howItWorks: [
      { title: "Scan", detail: "Reviews every Odoo vendor bill as it lands." },
      { title: "Compare", detail: "Checks references, amounts, dates and vendor identities." },
      { title: "Confirm", detail: "AI verifies suspected resubmissions line by line." },
      { title: "Flag", detail: "Raises high-confidence duplicates for review and logs every check to the bill." },
    ],
    accent: "gold",
  },
  {
    slug: "shield",
    name: "Shield",
    tagline: "Your internal-audit watchdog — surfaces suspicious vendor bills for review.",
    domain: "Accounting",
    role: "Fraud-risk & internal audit",
    summary:
      "Shield reviews your Odoo vendor bills for fraud-risk signals and builds a ranked review queue " +
      "for an internal auditor. It watches for the classic payment-diversion pattern, vendor details " +
      "colliding with an employee's, segregation-of-duties breaks, phantom-vendor markers, off-norm " +
      "amounts and statistical tells — each alert carrying the evidence that fired it. It surfaces risk " +
      "for a human to judge; it never accuses.",
    capabilities: [
      "Detects a vendor bank account changed right before an unpaid bill (payment diversion)",
      "Catches vendor details colliding with an employee's",
      "Flags segregation-of-duties breaks and phantom-vendor markers",
      "Spots off-norm amounts and statistical outliers",
      "Every alert carries the evidence that fired it — advisory, never accusatory",
    ],
    howItWorks: [
      { title: "Watch", detail: "Monitors vendor bills and vendor-master changes in Odoo." },
      { title: "Assess", detail: "Scores each bill against a battery of fraud-risk signals." },
      { title: "Rank", detail: "Builds a review queue ordered by risk." },
      { title: "Brief", detail: "Hands the auditor each alert with its supporting evidence." },
    ],
    accent: "gold",
  },
  {
    slug: "decode",
    name: "Decode",
    tagline: "Your recruitment sidekick — turns résumés into Odoo applicants.",
    domain: "HR",
    role: "Résumé parsing",
    summary:
      "Decode reads every résumé you upload, email in, or already have in Odoo, extracts the " +
      "candidate's details with AI, and fills out their Odoo applicant record — contact info, the " +
      "position they applied for (or the talent pool), skills, and a summary note. It reads the " +
      "résumé's text when it can and the page images when it can't, and flags anything a recruiter " +
      "should double-check.",
    capabilities: [
      "Reads résumés from uploads, email, or existing Odoo records",
      "Extracts contact details, skills and the role applied for",
      "Fills the Odoo applicant record and writes a summary note",
      "Reads the text when it can, the page images when it can't",
      "Flags anything a recruiter should double-check",
    ],
    howItWorks: [
      { title: "Ingest", detail: "Drop in résumés or point Decode at your Odoo pipeline." },
      { title: "Read", detail: "Text-first, image-fallback AI reads every page." },
      { title: "Map", detail: "Details map onto the right Odoo applicant and skills." },
      { title: "File", detail: "The applicant record is filled in and ready for review." },
    ],
    accent: "hr",
  },
  {
    slug: "scout",
    name: "Scout",
    tagline: "Your recruitment sidekick — scores candidates against the role.",
    domain: "HR",
    role: "Candidate scoring",
    summary:
      "Scout reviews the applicants in your Odoo, reads each résumé, and scores how well the candidate " +
      "fits the job they applied for — with an honest breakdown of strengths, weaknesses, and " +
      "highlights. It sets the applicant's evaluation stars, posts a scoring note, and tags who it has " +
      "reviewed. Run it on a schedule or on demand.",
    capabilities: [
      "Reads each applicant's résumé against the job they applied for",
      "Scores fit with an honest breakdown of strengths and weaknesses",
      "Sets the applicant's Odoo evaluation stars",
      "Posts a scoring note and tags who it has reviewed",
      "Runs on a schedule or on demand",
    ],
    howItWorks: [
      { title: "Gather", detail: "Pulls the applicants assigned to each open role." },
      { title: "Read", detail: "Reads the résumé against the full job profile." },
      { title: "Score", detail: "Grades fit with specific, explained reasoning." },
      { title: "Record", detail: "Sets stars, posts the note, and marks the applicant reviewed." },
    ],
    accent: "hr",
  },
];

export const rosterBySlug: Record<string, RosterEntry> = Object.fromEntries(
  ROSTER.map((entry) => [entry.slug, entry])
);

/** Group labels + order for the landing roster — mirrors the in-app `FUNCTION_GROUPS`. */
export const DOMAIN_ORDER: Domain[] = ["Sales", "Accounting", "HR"];

/** The roster grouped by domain, in `DOMAIN_ORDER`, dropping any empty group. */
export function rosterByDomain(): { domain: Domain; entries: RosterEntry[] }[] {
  return DOMAIN_ORDER.map((domain) => ({
    domain,
    entries: ROSTER.filter((entry) => entry.domain === domain),
  })).filter((group) => group.entries.length > 0);
}
