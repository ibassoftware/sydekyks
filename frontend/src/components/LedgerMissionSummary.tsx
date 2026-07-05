import { Badge } from "./ui";

export function LedgerMissionSummary({ summary }: { summary: Record<string, unknown> }) {
  const vendor = (summary.vendor_name as string) ?? "Unknown vendor";
  const invoice = summary.invoice_number as string | null;
  const total = summary.total as number | undefined;
  const currency = (summary.currency as string) ?? "";
  const confidence = summary.confidence as number | undefined;
  const posted = summary.posted as boolean | undefined;
  const duplicate = summary.duplicate as boolean | undefined;
  const needsReview = summary.needs_review as boolean | undefined;
  const reviewReason = summary.review_reason as string | undefined;
  const moveName = summary.odoo_move_name as string | undefined;

  return (
    <div className="mt-2 grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-[#f5eee0]">{vendor}</p>
        {invoice && <span className="text-xs text-[#8a7f6d]">#{invoice}</span>}
        {total !== undefined && (
          <span className="text-sm text-[#ede6da]">
            {currency} {total.toFixed(2)}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {duplicate && <Badge tone="danger">Duplicate</Badge>}
        {needsReview && !duplicate && <Badge tone="danger">Needs review</Badge>}
        {posted && <Badge tone="gold">Posted{moveName ? ` · ${moveName}` : ""}</Badge>}
        {!posted && !needsReview && !duplicate && moveName && <Badge tone="neutral">Draft · {moveName}</Badge>}
        {confidence !== undefined && (
          <span className="inline-flex items-center gap-1.5 text-xs text-[#b9ad98]">
            <span
              className={`h-1.5 w-1.5 rounded-full ${confidence >= 90 ? "bg-gold-400" : confidence >= 60 ? "bg-amber-500" : "bg-red-500"}`}
            />
            {confidence}% confidence
          </span>
        )}
      </div>

      {reviewReason && <p className="text-xs text-amber-400/90">{reviewReason}</p>}
    </div>
  );
}
