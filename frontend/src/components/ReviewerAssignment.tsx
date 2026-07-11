import { useEffect, useState } from "react";
import { api, type OdooUser, type ReviewerConfig } from "../lib/api";
import { Input, Label } from "./ui";

/** Shared across every agent (DRY): when a Sydekyk flags something for review, create an Odoo To-Do
 * for the picked users. Users are loaded from the Sydekyk's assigned Odoo. A daily cron also alerts
 * the admin if an assigned reviewer is later removed or deactivated in Odoo. */
export function ReviewerAssignment({ sydekykId, canManage }: { sydekykId: string; canManage: boolean }) {
  const [users, setUsers] = useState<OdooUser[] | null>(null);
  const [cfg, setCfg] = useState<ReviewerConfig | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<OdooUser[]>(`/tenant/sydekyks/${sydekykId}/odoo-users`).then((r) => setUsers(r.data)).catch(() => setUsers([]));
    api.get<ReviewerConfig>(`/tenant/sydekyks/${sydekykId}/reviewers`).then((r) => setCfg(r.data)).catch(() => setCfg(null));
  }, [sydekykId]);

  async function save(next: ReviewerConfig) {
    setSaving(true);
    try {
      const r = await api.put<ReviewerConfig>(`/tenant/sydekyks/${sydekykId}/reviewers`, next);
      setCfg(r.data);
    } finally {
      setSaving(false);
    }
  }

  if (!cfg) return null;
  const selected = new Set(cfg.odoo_user_ids);

  function toggleUser(id: number) {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    save({ ...cfg!, odoo_user_ids: [...next] });
  }

  return (
    <div className="grid gap-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Review Assignment</p>
      <p className="-mt-1 text-xs text-[#8a7f6d]">
        When this Sydekyk flags something for review, create an Odoo To-Do for the people you pick. You'll be alerted
        if an assigned reviewer is later removed or deactivated in Odoo.
      </p>

      <label className="flex items-center gap-2 text-sm text-[#ede6da]">
        <input
          type="checkbox"
          className="h-4 w-4 accent-gold-500"
          disabled={!canManage || saving}
          checked={cfg.create_activity}
          onChange={(e) => save({ ...cfg, create_activity: e.target.checked })}
        />
        Create an Odoo activity for reviewers when flagged
      </label>

      {cfg.create_activity && (
        <>
          <div>
            <Label>Reviewers</Label>
            {users === null ? (
              <p className="text-sm text-[#8a7f6d]">Loading…</p>
            ) : users.length === 0 ? (
              <p className="text-sm text-amber-400/90">No Odoo users found — assign an Odoo instance above first.</p>
            ) : (
              <div className="mt-1 grid max-h-56 gap-0.5 overflow-auto rounded-lg border border-ink-700 p-1">
                {users.map((u) => (
                  <label key={u.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm text-[#ede6da] hover:bg-ink-800/50">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-gold-500"
                      disabled={!canManage || saving}
                      checked={selected.has(u.id)}
                      onChange={() => toggleUser(u.id)}
                    />
                    <span className="min-w-0 flex-1 truncate">{u.name}</span>
                    {u.login && <span className="shrink-0 text-xs text-[#8a7f6d]">{u.login}</span>}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="w-40">
            <Label>Due in (days)</Label>
            <Input
              type="number" min={0} max={60}
              disabled={!canManage || saving}
              value={cfg.activity_days}
              onChange={(e) => setCfg({ ...cfg, activity_days: Number(e.target.value) })}
              onBlur={(e) => save({ ...cfg, activity_days: Number(e.target.value) })}
            />
          </div>
        </>
      )}
    </div>
  );
}
