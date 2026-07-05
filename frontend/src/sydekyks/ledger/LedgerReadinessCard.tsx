import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type LedgerReadiness, type ReadinessState } from "../../lib/api";

const DOT: Record<ReadinessState, string> = {
  ok: "bg-gold-400 shadow-[0_0_8px_2px_rgba(234,194,95,0.6)]",
  warn: "bg-amber-500",
  blocked: "bg-red-500",
};

const LABEL: Record<ReadinessState, string> = { ok: "Ready", warn: "Attention", blocked: "Action needed" };

/** VS-1: the guided setup checklist. Also exposes readiness upward so the upload panel can gate. */
export function LedgerReadinessCard({ onReadiness }: { onReadiness?: (r: LedgerReadiness) => void }) {
  const [readiness, setReadiness] = useState<LedgerReadiness | null>(null);

  useEffect(() => {
    api.get<LedgerReadiness>("/tenant/ledger/readiness").then((res) => {
      setReadiness(res.data);
      onReadiness?.(res.data);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!readiness) return <p className="text-sm text-[#8a7f6d]">Checking readiness…</p>;

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Ledger Readiness</p>
      <ul className="mt-3 grid gap-2">
        {readiness.items.map((item) => {
          const isRoute = item.action_href?.startsWith("/");
          return (
            <li key={item.key} className="flex items-center justify-between gap-3 rounded-lg border border-ink-700 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[item.state]}`} />
                <div className="min-w-0">
                  <p className="truncate text-sm text-[#ede6da]">{item.label}</p>
                  {item.detail && <p className="truncate text-xs text-[#8a7f6d]">{item.detail}</p>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-[11px] uppercase tracking-wide text-[#8a7f6d]">{LABEL[item.state]}</span>
                {item.action_label && item.action_href && item.state !== "ok" && (
                  isRoute ? (
                    <Link to={item.action_href} className="text-xs font-semibold text-gold-400 hover:text-gold-300">
                      {item.action_label} →
                    </Link>
                  ) : (
                    <a href={item.action_href} className="text-xs font-semibold text-gold-400 hover:text-gold-300">
                      {item.action_label} →
                    </a>
                  )
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {!readiness.can_upload && (
        <p className="mt-3 text-xs text-red-400">Complete the required steps above before uploading bills.</p>
      )}
    </div>
  );
}
