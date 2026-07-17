import { type MissionDetail } from "../lib/api";
import { ReviewActions } from "./review";
import { registryForPlaybook } from "../sydekyks/registry";

/**
 * The expanded detail for one Mission — summary, Odoo link, error, review + retry actions, and the
 * step trail. Shared by the Missions page, the Roster upload section, and anywhere a Mission can be
 * inspected, so all surfaces render identical detail.
 */
export function MissionDetailPanel({ detail, onChanged }: { detail: MissionDetail; onChanged?: () => void }) {
  const reg = registryForPlaybook(detail.playbook_key);
  const Summary = reg?.missionSummary;
  const isHr = reg?.domain === "hr";
  const needsReview = Boolean(detail.result_summary?.needs_review);
  // Review context (needs-review or failed) routes through the shared control so Missions, the
  // Mission detail and the Missions attention view offer the exact same review + retry actions.
  const showReview = needsReview || detail.status === "failed";

  return (
    <div className="grid gap-4">
      {detail.result_summary &&
        (Summary ? <Summary summary={detail.result_summary} /> : <GenericSummary summary={detail.result_summary} />)}

      {detail.odoo_bill_url && !needsReview && (
        <a
          href={detail.odoo_bill_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-fit items-center gap-1 text-xs font-semibold text-gold-400 hover:text-gold-300"
        >
          Open bill in Odoo →
        </a>
      )}

      {detail.odoo_record_url && !needsReview && (
        <a
          href={detail.odoo_record_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-fit items-center gap-1 text-xs font-semibold text-gold-400 hover:text-gold-300"
        >
          {detail.odoo_record_label ?? "Open in Odoo"} →
        </a>
      )}

      {detail.error_message && <p className="text-sm text-red-400">{detail.error_message}</p>}

      {showReview && (
        <ReviewActions
          target={{
            missionId: detail.id,
            needsReview,
            reviewed: detail.reviewed ?? false,
            odooBillUrl: detail.odoo_bill_url,
            odooRecordUrl: detail.odoo_record_url,
            odooRecordLabel: detail.odoo_record_label,
            recordKind: isHr ? "applicant" : "bill",
            canRetry: showReview,
          }}
          onChanged={onChanged}
        />
      )}

      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-gold-500/80">Steps</p>
        <ol className="grid gap-1.5">
          {detail.steps.map((s) => (
            <li key={s.step_index} className="flex items-start gap-2 text-xs">
              <span
                className={`mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                  s.status === "succeeded"
                    ? "bg-gold-400"
                    : s.status === "failed"
                      ? "bg-red-500"
                      : s.status === "skipped"
                        ? "bg-ink-600"
                        : "bg-amber-500"
                }`}
              />
              <span className="text-[#b9ad98]">
                <span className="font-medium text-[#ede6da]">{s.step_key}</span> — {s.status}
                {s.error_message && <span className="text-red-400"> · {s.error_message}</span>}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function GenericSummary({ summary }: { summary: Record<string, unknown> }) {
  return (
    <div className="grid gap-1 text-xs">
      {Object.entries(summary).map(([k, v]) => (
        <div key={k} className="flex gap-2">
          <span className="text-[#8a7f6d]">{k}:</span>
          <span className="text-[#ede6da]">{String(v)}</span>
        </div>
      ))}
    </div>
  );
}
