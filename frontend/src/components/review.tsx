import { useState } from "react";
import { api } from "../lib/api";
import { Badge, Button } from "./ui";
import { WarningIcon } from "./icons";

export function timeAgo(iso: string): string {
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return `${Math.floor(day / 30)}mo ago`;
}

/** Human-friendly run time between two timestamps, e.g. "4 seconds", "1 min 4 sec", "2 min". Shared
 * by the Missions list and the Issues review rows so both highlight how long a Mission took. */
export function formatDuration(startIso: string, endIso: string): string | null {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec} second${sec === 1 ? "" : "s"}`;
  const mins = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem ? `${mins} min ${rem} sec` : `${mins} min`;
}

/** Single source of truth for the review state pill, used on Missions and mission detail. */
export function ReviewBadge({ reviewed, needsReview }: { reviewed?: boolean; needsReview?: boolean }) {
  if (reviewed) return <Badge tone="gold">Reviewed</Badge>;
  if (needsReview) return <Badge tone="danger">Needs review</Badge>;
  return null;
}

export interface ReviewTarget {
  missionId: string;
  needsReview: boolean; // the Playbook flagged this Mission for review
  reviewed: boolean;
  reviewedByEmail?: string | null;
  reviewedAt?: string | null;
  odooBillUrl?: string | null;
  // Generic Odoo record (e.g. the Decode/Scout applicant). When recordKind is "applicant" the
  // bill-specific "draft"/"not created" copy is replaced by this plain record link.
  odooRecordUrl?: string | null;
  odooRecordLabel?: string | null;
  recordKind?: "bill" | "applicant";
  canRetry?: boolean; // failed, or a fixed needs-review case worth re-running
}

/**
 * The canonical review action row: the Odoo draft link (or a "not created" note), the
 * Mark reviewed / Undo sign-off, and Retry. Shared by the Missions attention view and Mission detail
 * panel so both surfaces behave and look identical. All mutations call `onChanged` so the
 * caller can refresh; the backend enforces the per-Sydekyk Use permission.
 */
export function ReviewActions({ target, onChanged }: { target: ReviewTarget; onChanged?: () => void }) {
  const [busy, setBusy] = useState<"review" | "retry" | null>(null);

  async function setReviewed(reviewed: boolean) {
    setBusy("review");
    try {
      if (reviewed) await api.post(`/tenant/missions/${target.missionId}/review`);
      else await api.delete(`/tenant/missions/${target.missionId}/review`);
      onChanged?.();
    } finally {
      setBusy(null);
    }
  }

  async function retry() {
    setBusy("retry");
    try {
      await api.post(`/tenant/missions/${target.missionId}/retry`);
      onChanged?.();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-4">
      {target.needsReview &&
        (target.recordKind === "applicant" ? (
          target.odooRecordUrl && (
            <a
              href={target.odooRecordUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-2 text-base font-medium text-gold-300 hover:text-heading"
            >
              {target.odooRecordLabel ?? "Open in Odoo"} →
            </a>
          )
        ) : target.odooBillUrl ? (
          <a
            href={target.odooBillUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-2 text-base font-medium text-gold-300 hover:text-heading"
          >
            Open draft in Odoo →
          </a>
        ) : (
          <span
            title="No Odoo bill was created for this Mission - fix the issue in Odoo, then retry to create it."
            className="inline-flex min-h-11 items-center gap-2 rounded-[2px] border-2 border-ink-600 bg-ink-800 px-3 py-2 text-sm font-medium text-body"
          >
            <WarningIcon className="h-3.5 w-3.5" /> Odoo bill not created
          </span>
        ))}

      {target.needsReview &&
        (target.reviewed ? (
          <div className="flex min-w-0 flex-wrap items-center gap-4">
            <span className="min-w-0 break-all text-sm text-body">
              Reviewed by {target.reviewedByEmail ?? "a teammate"}
              {target.reviewedAt ? ` · ${timeAgo(target.reviewedAt)}` : ""}
            </span>
            <Button variant="ghost" disabled={busy === "review"} onClick={() => setReviewed(false)}>
              {busy === "review" ? "…" : "Undo review"}
            </Button>
          </div>
        ) : (
          <Button disabled={busy === "review"} onClick={() => setReviewed(true)}>
            {busy === "review" ? "…" : "Mark reviewed"}
          </Button>
        ))}

      {target.canRetry && (
        <Button variant="ghost" disabled={busy === "retry"} onClick={retry}>
          {busy === "retry" ? "Retrying…" : "Retry mission"}
        </Button>
      )}
    </div>
  );
}
