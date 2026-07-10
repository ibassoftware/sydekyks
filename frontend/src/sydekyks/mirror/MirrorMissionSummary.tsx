import { Badge } from "../../components/ui";

export function MirrorMissionSummary({ summary }: { summary: Record<string, unknown> }) {
  const vendor = (summary.vendor_name as string) ?? "Vendor";
  const ref = summary.ref as string | null;
  const amount = summary.amount as number | undefined;
  const currency = (summary.currency as string) ?? "";
  const isDup = summary.is_duplicate as boolean | undefined;
  const confidence = summary.confidence as number | undefined;
  const tier = summary.tier as string | undefined;
  const matched = summary.matched_count as number | undefined;
  const suppressed = summary.suppressed as boolean | undefined;

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
        {isDup ? (
          <Badge tone="danger">Possible duplicate · {confidence}%</Badge>
        ) : matched ? (
          <Badge tone="neutral">Checked · low confidence</Badge>
        ) : (
          <Badge tone="gold">Unique</Badge>
        )}
        {tier && tier !== "none" && <span className="text-xs text-[#8a7f6d]">tier: {tier}</span>}
        {suppressed && <Badge tone="neutral">Recurring (suppressed)</Badge>}
        {typeof matched === "number" && matched > 0 && (
          <span className="text-xs text-[#8a7f6d]">{matched} match{matched === 1 ? "" : "es"}</span>
        )}
      </div>
    </div>
  );
}
