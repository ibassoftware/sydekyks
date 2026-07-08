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

/** Single source of truth for the review state pill, used on Missions, Issues, and mission detail. */
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
  canRetry?: boolean; // failed, or a fixed needs-review case worth re-running
}

/**
 * The canonical review action row: the Odoo draft link (or a "not created" note), the
 * Mark reviewed / Undo sign-off, and Retry. Shared by the Issues page and the Mission detail
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
    <div className="flex flex-wrap items-center gap-3">
      {target.needsReview &&
        (target.odooBillUrl ? (
          <a
            href={target.odooBillUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-gold-600/40 bg-gold-500/10 px-3 py-1.5 text-xs font-semibold text-gold-300 hover:bg-gold-500/20"
          >
            Open draft in Odoo →
          </a>
        ) : (
          <span
            title="No Odoo bill was created for this Mission — fix the issue in Odoo, then retry to create it."
            className="inline-flex items-center gap-1.5 rounded-md border border-ink-600 bg-ink-800/60 px-3 py-1.5 text-xs font-medium text-[#8a7f6d]"
          >
            <WarningIcon className="h-3.5 w-3.5" /> Odoo bill not created
          </span>
        ))}

      {target.needsReview &&
        (target.reviewed ? (
          <div className="flex items-center gap-3">
            <span className="text-xs text-[#8a7f6d]">
              Reviewed by {target.reviewedByEmail ?? "a teammate"}
              {target.reviewedAt ? ` · ${timeAgo(target.reviewedAt)}` : ""}
            </span>
            <Button variant="ghost" className="px-3 py-1.5 text-xs" disabled={busy === "review"} onClick={() => setReviewed(false)}>
              {busy === "review" ? "…" : "Undo review"}
            </Button>
          </div>
        ) : (
          <Button className="px-3 py-1.5 text-xs" disabled={busy === "review"} onClick={() => setReviewed(true)}>
            {busy === "review" ? "…" : "Mark reviewed"}
          </Button>
        ))}

      {target.canRetry && (
        <Button variant="ghost" className="px-3 py-1.5 text-xs" disabled={busy === "retry"} onClick={retry}>
          {busy === "retry" ? "Retrying…" : "Retry mission"}
        </Button>
      )}
    </div>
  );
}
