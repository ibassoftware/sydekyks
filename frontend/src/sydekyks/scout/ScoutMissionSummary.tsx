import { Badge } from "../../components/ui";

export function ScoutMissionSummary({ summary }: { summary: Record<string, unknown> }) {
  const name = (summary.applicant_name as string) ?? "Candidate";
  const jobName = summary.job_name as string | undefined;
  const score = summary.score as number | undefined;
  const needsReview = summary.needs_review as boolean | undefined;
  const reviewReason = summary.review_reason as string | undefined;

  const tone = score === undefined ? "bg-ink-500" : score >= 85 ? "bg-gold-400" : score >= 60 ? "bg-amber-500" : "bg-red-500";

  return (
    <div className="mt-2 grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-[#f5eee0]">{name}</p>
        {jobName && <span className="text-xs text-[#8a7f6d]">{jobName}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {score !== undefined && (
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#ede6da]">
            <span className={`h-2 w-2 rounded-full ${tone}`} /> {score}/100
          </span>
        )}
        {needsReview && <Badge tone="danger">Needs review</Badge>}
      </div>
      {reviewReason && <p className="text-xs text-amber-400/90">{reviewReason}</p>}
    </div>
  );
}
