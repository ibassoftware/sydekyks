import { Badge } from "../../components/ui";

type Flag = { label?: string; evidence?: string | null };

export function ShieldMissionSummary({ summary }: { summary: Record<string, unknown> }) {
  const vendor = (summary.vendor_name as string) ?? "Vendor";
  const ref = summary.ref as string | null;
  const amount = summary.amount as number | undefined;
  const currency = (summary.currency as string) ?? "";
  const risk = summary.risk_score as number | undefined;
  const hold = summary.hold as boolean | undefined;
  const flagCount = summary.flag_count as number | undefined;
  const needsReview = summary.needs_review as boolean | undefined;
  const briefing = summary.summary as string | null;
  const flags = (summary.flags as Flag[] | undefined) ?? [];

  return (
    <div className="mt-2 grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-[#f5eee0]">{vendor}</p>
        {ref && <span className="text-xs text-[#8a7f6d]">#{ref}</span>}
        {amount !== undefined && (
          <span className="text-sm text-[#ede6da]">
            {currency} {amount.toFixed(2)}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {hold ? (
          <Badge tone="danger">Hard-hold · risk {risk}</Badge>
        ) : needsReview ? (
          <Badge tone="danger">Warrants review · risk {risk}</Badge>
        ) : (
          <Badge tone="gold">No risk signals</Badge>
        )}
        {typeof flagCount === "number" && flagCount > 0 && (
          <span className="text-xs text-[#8a7f6d]">{flagCount} signal{flagCount === 1 ? "" : "s"}</span>
        )}
      </div>

      {/* The AI's advisory "why it warrants review" briefing + the evidence, right here in the Mission. */}
      {briefing && (
        <div className="rounded-lg border border-amber-700/40 bg-amber-500/[0.06] px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-400/90">Why it warrants review</p>
          <p className="mt-1 text-sm text-[#d8cdb9]">{briefing}</p>
        </div>
      )}
      {flags.length > 0 && (
        <ul className="grid gap-1">
          {flags.map((f, i) => (
            <li key={i} className="text-xs text-[#8a7f6d]">
              • <span className="text-[#b9ad98]">{f.label}</span>
              {f.evidence ? ` - ${f.evidence}` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
