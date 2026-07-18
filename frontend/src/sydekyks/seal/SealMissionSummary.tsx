import { Link } from "react-router-dom";

/** Renders a Seal mission's business object - the contract it drafted, revised, or reviewed - with a
 * jump back into the editor. Reads from `result_summary`. */
export function SealMissionSummary({ summary }: { summary: Record<string, unknown> }) {
  const contractId = summary.contract_id as string | undefined;
  const title = (summary.title as string) || "the contract";
  const action = summary.action as string | undefined;
  const counterparty = summary.counterparty as string | undefined;
  const changed = summary.changed as string | undefined;
  const findings = summary.findings as number | undefined;
  const high = summary.high as number | undefined;

  const verb = action === "revised" ? "Revised" : action === "reviewed" ? "Reviewed" : "Drafted";

  return (
    <div className="text-sm text-[#d8cdb9]">
      <p>
        <span className="text-gold-300">{verb}</span> the contract “{title}”
        {counterparty ? <span className="text-[#8a7f6d]"> with {counterparty}</span> : null}
      </p>
      {action === "reviewed" && (
        <p className="mt-1 text-xs text-[#8a7f6d]">
          {(findings ?? 0).toLocaleString()} finding{findings === 1 ? "" : "s"}
          {high ? <span className="text-amber-300"> · {high} high-severity</span> : null}
        </p>
      )}
      {changed && <p className="mt-1 text-xs text-[#8a7f6d]">{changed}</p>}
      {contractId && (
        <Link to={`/hq/seal/editor/${contractId}`} className="mt-2 inline-block text-xs font-semibold text-gold-400 hover:text-gold-300">
          Open in editor →
        </Link>
      )}
    </div>
  );
}
