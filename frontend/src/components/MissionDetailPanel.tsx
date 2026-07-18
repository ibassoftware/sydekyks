import { type MissionDetail } from "../lib/api";
import { buttonClassName } from "./ui";
import { ReviewActions } from "./review";
import { registryForPlaybook } from "../sydekyks/registry";

/** Compact, shared Mission expansion: outcome, decisions and execution trail stay visually
 * separate without turning one opened Mission into a mostly-empty page. */
export function MissionDetailPanel({ detail, onChanged }: { detail: MissionDetail; onChanged?: () => void }) {
  const registry = registryForPlaybook(detail.playbook_key);
  const Summary = registry?.missionSummary;
  const isHr = registry?.domain === "hr";
  const needsReview = Boolean(detail.result_summary?.needs_review);
  const showReview = needsReview || detail.status === "failed";

  return (
    <div className="grid min-w-0 gap-4">
      {detail.result_summary && (
        <section aria-label="Mission outcome" className="min-w-0 rounded-[4px] border-2 border-ink-600 bg-ink-900 p-4">
          <p className="mb-3 text-xs font-medium uppercase tracking-[0.4px] text-gold-300">Outcome</p>
          {Summary ? <Summary summary={detail.result_summary} /> : <GenericSummary summary={detail.result_summary} />}
        </section>
      )}

      {(detail.odoo_bill_url || detail.odoo_record_url) && !needsReview && (
        <div className="flex min-w-0 flex-wrap gap-3">
          {detail.odoo_bill_url && (
            <a href={detail.odoo_bill_url} target="_blank" rel="noopener noreferrer" className={buttonClassName("ghost")}>
              Open bill in Odoo →
            </a>
          )}
          {detail.odoo_record_url && (
            <a href={detail.odoo_record_url} target="_blank" rel="noopener noreferrer" className={buttonClassName("ghost")}>
              {detail.odoo_record_label ?? "Open in Odoo"} →
            </a>
          )}
        </div>
      )}

      {detail.error_message && (
        <div role="alert" className="rounded-[4px] border-2 border-red-700/50 bg-red-500/10 p-4">
          <p className="text-xs font-medium uppercase tracking-[0.4px] text-red-400">Mission failure</p>
          <p className="mt-2 break-words text-sm leading-6 text-heading">{detail.error_message}</p>
        </div>
      )}

      {showReview && (
        <section aria-label="Mission decisions" className="rounded-[4px] border-2 border-amber-600/40 bg-amber-500/[0.06] p-4">
          <p className="mb-3 text-xs font-medium uppercase tracking-[0.4px] text-amber-400">Command decision</p>
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
        </section>
      )}

      <section aria-label="Mission steps" className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-[0.4px] text-gold-300">Execution trail</p>
          <span className="text-sm text-body">{detail.steps.length} step{detail.steps.length === 1 ? "" : "s"}</span>
        </div>
        {detail.steps.length === 0 ? (
          <p className="rounded-[4px] border-2 border-ink-700 bg-ink-900 p-4 text-sm text-body">No execution steps were recorded.</p>
        ) : (
          <ol className="grid min-w-0 gap-2 md:grid-cols-2">
            {detail.steps.map((step) => {
              const tone = step.status === "failed"
                ? "border-red-700/50 bg-red-500/[0.06]"
                : step.status === "succeeded"
                  ? "border-ink-600 bg-ink-900"
                  : "border-amber-600/40 bg-amber-500/[0.05]";
              const dot = step.status === "succeeded" ? "bg-gold-400" : step.status === "failed" ? "bg-red-500" : step.status === "skipped" ? "bg-ink-500" : "bg-amber-500";
              return (
                <li key={step.step_index} className={`min-w-0 rounded-[4px] border-2 p-3 ${tone}`}>
                  <div className="flex min-w-0 items-start gap-3">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="break-words text-sm font-semibold text-heading">{step.step_key}</p>
                      <p className="mt-1 text-xs font-medium uppercase tracking-[0.4px] text-body">{step.status}</p>
                      {step.error_message && <p className="mt-2 break-words text-sm leading-6 text-red-400">{step.error_message}</p>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}

function GenericSummary({ summary }: { summary: Record<string, unknown> }) {
  return (
    <dl className="grid min-w-0 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
      {Object.entries(summary).map(([key, value]) => (
        <div key={key} className="min-w-0">
          <dt className="break-words text-xs font-medium uppercase tracking-[0.4px] text-body">{key.replaceAll("_", " ")}</dt>
          <dd className="mt-1 break-words text-sm leading-6 text-heading">{formatValue(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function formatValue(value: unknown): string {
  if (value == null) return " - ";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
