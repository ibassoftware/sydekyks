import { Badge } from "../../components/ui";

export function ShieldMissionSummary({ summary }: { summary: Record<string, unknown> }) {
  const vendor = (summary.vendor_name as string) ?? "Vendor";
  const ref = summary.ref as string | null;
  const amount = summary.amount as number | undefined;
  const currency = (summary.currency as string) ?? "";
  const risk = summary.risk_score as number | undefined;
  const hold = summary.hold as boolean | undefined;
  const flagCount = summary.flag_count as number | undefined;
  const needsReview = summary.needs_review as boolean | undefined;

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
    </div>
  );
}
