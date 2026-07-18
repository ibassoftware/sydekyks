import { useEffect, useState } from "react";
import { api, type LedgerReadiness } from "../../lib/api";
import { ReadinessList } from "../ReadinessList";

/** VS-1: the guided setup checklist. Also exposes readiness upward so the upload panel can gate.
 * `refreshKey` lets the parent force a re-fetch (e.g. after the vision test flips "vision verified"). */
export function LedgerReadinessCard({ onReadiness, refreshKey = 0, showHeading = true }: { onReadiness?: (r: LedgerReadiness) => void; refreshKey?: number; showHeading?: boolean }) {
  const [readiness, setReadiness] = useState<LedgerReadiness | null>(null);

  useEffect(() => {
    api.get<LedgerReadiness>("/tenant/ledger/readiness").then((res) => {
      setReadiness(res.data);
      onReadiness?.(res.data);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  if (!readiness) return <p className="text-sm text-body">Checking readiness...</p>;

  return (
    <div>
      {showHeading && <h3>Ledger readiness</h3>}
      <div className={showHeading ? "mt-4" : ""}><ReadinessList items={readiness.items} /></div>
      {!readiness.can_upload && (
        <p className="mt-3 text-xs text-danger-strong">Complete the required steps above before uploading bills.</p>
      )}
    </div>
  );
}
