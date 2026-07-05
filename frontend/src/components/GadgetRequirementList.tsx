import { useEffect, useState } from "react";
import { api, type GadgetRequirement } from "../lib/api";
import { Label } from "./ui";

const selectClass =
  "w-full rounded-md border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-[#ede6da] outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500/50";

export function GadgetRequirementList({ sydekykId, canManage }: { sydekykId: string; canManage: boolean }) {
  const [requirements, setRequirements] = useState<GadgetRequirement[] | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    api.get<GadgetRequirement[]>(`/tenant/sydekyks/${sydekykId}/gadget-requirements`).then((r) => setRequirements(r.data));
  }, [sydekykId]);

  async function assign(req: GadgetRequirement, linkId: string) {
    setSavingId(req.requirement_id);
    try {
      if (linkId === "") {
        await api.delete(`/tenant/sydekyks/${sydekykId}/gadget-requirements/${req.requirement_id}/assignment`);
      } else {
        await api.put(`/tenant/sydekyks/${sydekykId}/gadget-requirements/${req.requirement_id}/assignment`, {
          gadget_link_id: linkId,
        });
      }
      setRequirements((prev) =>
        prev?.map((r) =>
          r.requirement_id === req.requirement_id ? { ...r, assigned_link_id: linkId || null } : r
        ) ?? null
      );
    } finally {
      setSavingId(null);
    }
  }

  if (!requirements || requirements.length === 0) return null;

  return (
    <div className="grid gap-3">
      {requirements.map((req) => (
        <div key={req.requirement_id}>
          <Label>
            {req.label}
            {req.is_required ? " *" : " (optional)"}
          </Label>
          {req.eligible_links.length === 0 ? (
            <p className="text-xs text-[#8a7f6d]">
              No {req.gadget_category} Gadget Links yet — connect one in Gadgets first.
            </p>
          ) : canManage ? (
            <select
              className={selectClass}
              disabled={savingId === req.requirement_id}
              value={req.assigned_link_id ?? ""}
              onChange={(e) => assign(req, e.target.value)}
            >
              <option value="">— Not assigned —</option>
              {req.eligible_links.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-sm text-[#ede6da]">
              {req.eligible_links.find((l) => l.id === req.assigned_link_id)?.name ?? "Not assigned"}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
