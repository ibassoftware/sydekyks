import { useEffect, useState } from "react";
import { api, type MirrorPlaybook } from "../../lib/api";
import { Badge } from "../../components/ui";

export function MirrorPlaybookPanel() {
  const [playbook, setPlaybook] = useState<MirrorPlaybook | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    api.get<MirrorPlaybook>("/tenant/mirror/playbook").then((res) => setPlaybook(res.data));
  }, []);

  if (!playbook) return null;

  return (
    <div>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-gold-500">Playbook</span>
        <span className="flex items-center gap-2">
          <Badge tone="neutral">Fixed · not editable</Badge>
          <span className="text-xs text-[#8a7f6d]">{open ? "▲" : "▼"}</span>
        </span>
      </button>
      {open && (
        <ol className="mt-3 grid gap-2">
          {playbook.steps.map((step, i) => (
            <li key={step.key} className="rounded-lg border border-ink-700 px-3 py-2.5">
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-semibold text-gold-500">{i + 1}</span>
                <p className="text-sm font-semibold text-[#ede6da]">{step.title}</p>
              </div>
              <p className="mt-1 text-xs text-[#b9ad98]">{step.description}</p>
              <p className="mt-1 text-xs text-[#8a7f6d]">Can fail if: {step.likely_failures}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
