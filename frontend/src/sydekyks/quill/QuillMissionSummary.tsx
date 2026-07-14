import { Link } from "react-router-dom";

/** Renders a Quill mission's business object — the proposal it drafted or revised — with a jump back
 * into the editor. Reads from `result_summary`. */
export function QuillMissionSummary({ summary }: { summary: Record<string, unknown> }) {
  const proposalId = summary.proposal_id as string | undefined;
  const title = (summary.title as string) || "the proposal";
  const action = summary.action as string | undefined;
  const customer = summary.customer as string | undefined;
  const changed = summary.changed as string | undefined;

  const verb = action === "revised" ? "Revised" : "Drafted";

  return (
    <div className="text-sm text-[#d8cdb9]">
      <p>
        <span className="text-gold-300">{verb}</span> the proposal “{title}”
        {customer ? <span className="text-[#8a7f6d]"> for {customer}</span> : null}
      </p>
      {changed && <p className="mt-1 text-xs text-[#8a7f6d]">{changed}</p>}
      {proposalId && (
        <Link to={`/hq/quill/editor/${proposalId}`} className="mt-2 inline-block text-xs font-semibold text-gold-400 hover:text-gold-300">
          Open in editor →
        </Link>
      )}
    </div>
  );
}
