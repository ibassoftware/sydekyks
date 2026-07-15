/** Public marketing copy for the Roster — the single source of truth for the landing page and every
 * per-Sydekyk showcase sub-page. Kept deliberately self-contained (no API, no imports from the authed
 * app) so it renders on the unauthenticated marketing routes and stays out of the app bundle.
 *
 * Copy is authored from each Sydekyk's authoritative tagline/description in
 * `backend/app/seed.py` (`_ROSTER_SYDEKYKS`). Group labels + order mirror the in-app roster
 * grouping (`FUNCTION_GROUPS` in `src/sydekyks/registry.tsx`) so naming stays consistent. */

export type RosterSlug = "nudge" | "quill" | "seal" | "signet" | "ledger" | "mirror" | "shield" | "decode" | "scout";

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
    slug: "quill",
    name: "Quill",
    tagline: "Your proposal-writing sidekick — turns notes into a polished, client-ready proposal.",
    domain: "Sales",
    role: "Proposal generation",
    summary:
      "Quill turns a template and your notes into a polished, client-ready proposal you can edit in a " +
      "rich web editor. Pick a template, drop in your notes, and Quill drafts the whole document — then " +
      "keep refining it by conversation (“shorten the intro”, “add a pricing table”), insert images, and " +
      "export a crisp PDF. Optionally ground the draft in a real Odoo opportunity, raise a draft sales " +
      "quotation, and merge its official PDF with the proposal.",
    capabilities: [
      "Drafts a full proposal as clean, editable HTML from your notes + a template",
      "Refine it by chat — Quill rewrites the work-in-progress on request",
      "Insert images, edit freely, and save your own reusable templates",
      "Exports a crisp, branded PDF",
      "Optional Odoo: ground in an opportunity, raise a quotation, and merge its PDF",
    ],
    howItWorks: [
      { title: "Draft", detail: "Pick a template, drop in your notes, and Quill writes the proposal." },
      { title: "Refine", detail: "Edit by hand or ask Quill to revise the document in place." },
      { title: "Illustrate", detail: "Insert images and save the result as a new template." },
      { title: "Export", detail: "Download a polished PDF — optionally merged with an Odoo quotation." },
    ],
    accent: "gold",
  },
  {
    slug: "seal",
    name: "Seal",
    tagline: "Your contract-drafting sidekick — writes contracts and reviews them clause-by-clause.",
    domain: "Sales",
    role: "Contract drafting & review",
    summary:
      "Seal drafts a contract from a template and your brief in a rich web editor, then reviews it " +
      "clause-by-clause and flags the risky, one-sided, or missing clauses — proposing a redline for " +
      "each that you accept or reject. Draft an NDA, service agreement, SOW or MSA, keep refining it by " +
      "conversation, import a counterparty's contract to review it, and export a clean PDF. Hand the " +
      "finished contract off for signing via Odoo Sign or the native Signet e-signature agent.",
    capabilities: [
      "Drafts a full contract as clean, editable HTML from your brief + a template",
      "Reviews clause-by-clause and flags risky, one-sided, or missing clauses",
      "Proposes a redline for each finding that you accept (auto-applied) or dismiss",
      "Import a counterparty's contract to review it, or refine yours by chat",
      "Exports a branded PDF and hands off to Odoo Sign or Signet for signature",
    ],
    howItWorks: [
      { title: "Draft", detail: "Pick a template, give Seal a plain-language brief, and it writes the contract." },
      { title: "Review", detail: "Seal reads it clause-by-clause and flags the risks, grounded in your playbook." },
      { title: "Redline", detail: "Accept a suggested redline and Seal edits the clause in place — or dismiss it." },
      { title: "Send", detail: "Export a clean PDF and hand off for signing via Odoo Sign or Signet." },
    ],
    accent: "gold",
  },
  {
    slug: "signet",
    name: "Signet",
    tagline: "Your e-signature sidekick — sends contracts out for signing and chases the stragglers.",
    domain: "Sales",
    role: "E-signature & tracking",
    summary:
      "Signet takes a finished contract and gets it signed. Add the signatories and their email " +
      "addresses, and Signet sends each a secure public signing link, tracks who has opened and signed, " +
      "and follows up automatically after a few days — while letting you hold or void a request at any " +
      "time. When everyone has signed, it assembles the final signed PDF with an audit trail. A native " +
      "e-signature path that needs no Odoo Enterprise.",
    capabilities: [
      "Sends each signatory a secure, public signing link — no account needed",
      "Tracks who has viewed, signed, or declined in real time",
      "Follows up automatically on a cadence you set, and lets you hold or void",
      "Assembles the final signed PDF with a certificate-of-completion audit trail",
      "Parallel or sequential signing order, with typed or drawn signatures",
    ],
    howItWorks: [
      { title: "Prepare", detail: "Add the signatories and their emails to a finished contract." },
      { title: "Send", detail: "Each signer gets a secure public link to review and sign — no login." },
      { title: "Track", detail: "Watch progress live and let Signet chase the stragglers for you." },
      { title: "Complete", detail: "Once all have signed, Signet assembles the signed PDF with an audit trail." },
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

/** A Sydekyk on the roadmap — not yet available, no detail page. Marketing-only teaser. */
export interface UpcomingSydekyk {
  name: string;
  /** What the agent does, e.g. "Collections Agent". */
  agent: string;
  /** The human role it backs up, e.g. "AR Officer". */
  replaces: string;
}

/** The public roadmap: Sydekyks we're building next, grouped by business area. New ones land
 * constantly, so this list grows. Anything shipped moves up into `ROSTER` above and drops out here. */
export const UPCOMING: { domain: string; entries: UpcomingSydekyk[] }[] = [
  {
    domain: "Finance",
    entries: [
      { name: "Chase", agent: "Collections Agent", replaces: "AR Officer" },
      { name: "Balance", agent: "Bank Reconciliation Assistant", replaces: "Accountant" },
      { name: "Match", agent: "Payment Matcher", replaces: "Accountant" },
      { name: "Audit", agent: "Expense Policy Checker", replaces: "Finance Auditor" },
      { name: "Beacon", agent: "Executive Finance Reporter", replaces: "Financial Analyst" },
    ],
  },
  {
    domain: "Recruitment",
    entries: [
      { name: "Echo", agent: "Interview Summarizer", replaces: "Recruiter" },
      { name: "Launch", agent: "Onboarding Coordinator", replaces: "HR Officer" },
      { name: "Verify", agent: "Document Validator", replaces: "HR Assistant" },
      { name: "Pulse", agent: "Attendance Exception Detector", replaces: "HR Admin" },
    ],
  },
  {
    domain: "Sales",
    entries: [
      { name: "Spark", agent: "Lead Qualification Agent", replaces: "SDR" },
      { name: "Forecast", agent: "Opportunity Forecast Agent", replaces: "Sales Manager" },
      { name: "Coach", agent: "Sales Call Reviewer", replaces: "Sales Manager" },
      { name: "Reply", agent: "Customer Email Responder", replaces: "Sales Support" },
    ],
  },
  {
    domain: "Purchasing",
    entries: [
      { name: "Source", agent: "RFQ Creator", replaces: "Buyer" },
      { name: "Comparex", agent: "Quotation Comparator", replaces: "Buyer" },
      { name: "Gauge", agent: "Supplier Scorecard", replaces: "Procurement Analyst" },
      { name: "Renew", agent: "Contract Renewal Reminder", replaces: "Procurement Officer" },
    ],
  },
  {
    domain: "Inventory",
    entries: [
      { name: "Stocker", agent: "Replenishment Agent", replaces: "Inventory Planner" },
      { name: "Sentinel", agent: "Inventory Exception Detector", replaces: "Inventory Controller" },
      { name: "Locate", agent: "Bin Optimization Agent", replaces: "Warehouse Supervisor" },
      { name: "Cycle", agent: "Cycle Count Planner", replaces: "Warehouse Staff" },
    ],
  },
  {
    domain: "Manufacturing",
    entries: [
      { name: "Vector", agent: "Production Scheduler", replaces: "Planner" },
      { name: "Prism", agent: "Quality Defect Detector", replaces: "QA Inspector" },
      { name: "Delay", agent: "Bottleneck Detector", replaces: "Production Manager" },
      { name: "Predict", agent: "Machine Downtime Predictor", replaces: "Maintenance Planner" },
    ],
  },
  {
    domain: "CRM & Customer Support",
    entries: [
      { name: "Halo", agent: "Customer Support Agent", replaces: "CSR" },
      { name: "Switch", agent: "Ticket Router", replaces: "Dispatcher" },
      { name: "Scribe", agent: "Knowledge Article Generator", replaces: "Technical Writer" },
      { name: "Mood", agent: "Customer Sentiment Analyzer", replaces: "Support Manager" },
    ],
  },
  {
    domain: "Data Quality",
    entries: [
      { name: "Cleanse", agent: "Duplicate Contact Detector", replaces: "Data Admin" },
      { name: "Twin", agent: "Duplicate Product Detector", replaces: "Data Admin" },
      { name: "Fixer", agent: "Missing Data Detector", replaces: "Data Admin" },
      { name: "Guardian", agent: "Compliance Monitor", replaces: "Compliance Officer" },
    ],
  },
];

/** Group labels + order for the landing roster — mirrors the in-app `FUNCTION_GROUPS`. */
export const DOMAIN_ORDER: Domain[] = ["Sales", "Accounting", "HR"];

/** The roster grouped by domain, in `DOMAIN_ORDER`, dropping any empty group. */
export function rosterByDomain(): { domain: Domain; entries: RosterEntry[] }[] {
  return DOMAIN_ORDER.map((domain) => ({
    domain,
    entries: ROSTER.filter((entry) => entry.domain === domain),
  })).filter((group) => group.entries.length > 0);
}
