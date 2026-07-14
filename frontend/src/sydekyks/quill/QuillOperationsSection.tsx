import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { marked } from "marked";
import { api, type QuillProposalPage, type QuillProposalSummary, type QuillTemplate, type QuillTemplateSummary } from "../../lib/api";
import { Button } from "../../components/ui";
import type { OperationsProps } from "../registry";

/** Quill's operations panel — the workbench entry point. Create a proposal (blank or from a template)
 * and jump into the full-page editor, plus a list of recent proposals to reopen or delete. */
export function QuillOperationsSection({ canManage }: OperationsProps) {
  const navigate = useNavigate();
  const [page, setPage] = useState<QuillProposalPage | null>(null);
  const [templates, setTemplates] = useState<QuillTemplateSummary[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    api.get<QuillProposalPage>("/tenant/quill/proposals", { params: { limit: 20 } }).then((r) => setPage(r.data)).catch(() => setPage(null));
  }, []);

  useEffect(() => {
    load();
    api.get<QuillTemplateSummary[]>("/tenant/quill/templates").then((r) => setTemplates(r.data)).catch(() => setTemplates([]));
  }, [load]);

  async function newProposal() {
    setCreating(true);
    try {
      const r = await api.post<QuillProposalSummary>("/tenant/quill/proposals", {
        title: "Untitled proposal",
        from_template_id: templateId || null,
      });
      // Prefill the editor from the template. HTML templates are prefilled server-side; Markdown ones
      // we convert client-side (marked) and save, so any template opens as an editable document.
      if (templateId) {
        try {
          const tpl = await api.get<QuillTemplate>(`/tenant/quill/templates/${templateId}`);
          if (tpl.data.format === "md" && tpl.data.body) {
            const html = await marked.parse(tpl.data.body);
            await api.put(`/tenant/quill/proposals/${r.data.id}`, { content_html: html });
          }
        } catch {
          /* non-fatal — the proposal still opens (blank), and Generate can fill it from the template */
        }
      }
      navigate(`/hq/quill/editor/${r.data.id}`);
    } finally {
      setCreating(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this proposal?")) return;
    await api.delete(`/tenant/quill/proposals/${id}`);
    load();
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">New Proposal</p>
          <p className="mt-1 text-sm text-[#8a7f6d]">Start blank or from a template, then draft, edit, and export in the workbench.</p>
        </div>
        {canManage && (
          <div className="flex items-end gap-2">
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="rounded-md border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-[#ede6da] outline-none focus:border-gold-500"
            >
              <option value="">Blank</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}{t.is_builtin ? " (built-in)" : ""}</option>
              ))}
            </select>
            <Button className="px-4 py-2 text-xs" disabled={creating} onClick={newProposal}>
              {creating ? "Creating…" : "New proposal"}
            </Button>
          </div>
        )}
      </div>

      <div className="mt-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Recent Proposals</p>
        {!page ? (
          <p className="mt-2 text-sm text-[#8a7f6d]">Loading…</p>
        ) : page.items.length === 0 ? (
          <p className="mt-2 text-sm text-[#8a7f6d]">No proposals yet — create one to get started.</p>
        ) : (
          <div className="mt-2 grid gap-2">
            {page.items.map((p) => (
              <div key={p.id} className="flex items-center gap-3 rounded-lg border border-ink-700 px-3 py-2 hover:border-gold-600/40">
                <button onClick={() => navigate(`/hq/quill/editor/${p.id}`)} className="min-w-0 flex-1 text-left">
                  <span className="text-sm text-[#ede6da]">{p.title}</span>
                  {p.customer_name && <span className="ml-2 text-xs text-[#8a7f6d]">· {p.customer_name}</span>}
                </button>
                <span className={`rounded-full border px-2 py-0.5 text-[11px] ${
                  p.status === "final" ? "border-gold-600/50 bg-gold-500/10 text-gold-300" : "border-ink-600 bg-ink-800/60 text-[#b9ad98]"
                }`}>{p.status}</span>
                {p.odoo_sale_order_name && <span className="text-[11px] text-[#8a7f6d]">{p.odoo_sale_order_name}</span>}
                <button onClick={() => navigate(`/hq/quill/editor/${p.id}`)} className="shrink-0 text-xs font-semibold text-gold-400 hover:text-gold-300">Open</button>
                {canManage && (
                  <button onClick={() => remove(p.id)} className="shrink-0 text-xs font-semibold text-red-300/80 hover:text-red-300">Delete</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
