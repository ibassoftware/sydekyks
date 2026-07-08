import { Badge } from "../../components/ui";

export function DecodeMissionSummary({ summary }: { summary: Record<string, unknown> }) {
  const name = (summary.applicant_name as string) ?? "Candidate";
  const jobName = summary.job_name as string | undefined;
  const pooling = summary.pooling as boolean | undefined;
  const skillsAdded = summary.skills_added as number | undefined;
  const needsReview = summary.needs_review as boolean | undefined;
  const reviewReason = summary.review_reason as string | undefined;

  return (
    <div className="mt-2 grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-[#f5eee0]">{name}</p>
        {pooling ? (
          <Badge tone="neutral">Pool</Badge>
        ) : (
          jobName && <span className="text-xs text-[#8a7f6d]">{jobName}</span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {typeof skillsAdded === "number" && skillsAdded > 0 && <Badge tone="gold">{skillsAdded} skills</Badge>}
        {needsReview && <Badge tone="danger">Needs review</Badge>}
      </div>
      {reviewReason && <p className="text-xs text-amber-400/90">{reviewReason}</p>}
    </div>
  );
}
