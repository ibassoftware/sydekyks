import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { marked } from "marked";
import { api, type QuillProposalPage, type QuillProposalSummary, type QuillTemplate, type QuillTemplateSummary } from "../../lib/api";
import { Button, Input, Label, Modal } from "../../components/ui";
import { toast } from "../../lib/toast";
import type { OperationsProps } from "../registry";

/** Quill's operations panel — the workbench entry point. Create a proposal (blank or from a template)
 * and jump into the full-page editor, plus a list of recent proposals to reopen or delete. */
export function QuillOperationsSection({ canManage }: OperationsProps) {
  const navigate = useNavigate();
  const [page, setPage] = useState<QuillProposalPage | null>(null);
  const [templates, setTemplates] = useState<QuillTemplateSummary[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [creating, setCreating] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);

  const load = useCallback(() => {
    api.get<QuillProposalPage>("/tenant/quill/proposals", { params: { limit: 20 } }).then((r) => setPage(r.data)).catch(() => setPage(null));
  }, []);
  const loadTemplates = useCallback(() => {
    api.get<QuillTemplateSummary[]>("/tenant/quill/templates").then((r) => setTemplates(r.data)).catch(() => setTemplates([]));
  }, []);

  useEffect(() => {
    load();
    loadTemplates();
  }, [load, loadTemplates]);

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
            <Button className="px-4 py-2 text-xs" variant="ghost" onClick={() => setShowTemplates(true)}>Manage templates</Button>
            <Button className="px-4 py-2 text-xs" disabled={creating} onClick={newProposal}>
              {creating ? "Creating…" : "New proposal"}
            </Button>
          </div>
        )}
      </div>

      {showTemplates && (
        <TemplatesManager
          canManage={canManage}
          onClose={() => { setShowTemplates(false); loadTemplates(); }}
        />
      )}

      <div className="mt-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">
          {page?.sees_all ? "All Proposals" : "Your Proposals"}
        </p>
        {page?.sees_all && (
          <p className="-mt-0.5 text-[11px] text-[#8a7f6d]">You can see every proposal in this HQ. Salespeople see only their own.</p>
        )}
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
                  {page.sees_all && p.owned_by && <span className="ml-2 text-[11px] text-[#7a7060]">— {p.owned_by}</span>}
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

/** Create / edit / delete proposal templates. Built-ins are read-only (viewable, and "Duplicate" makes
 * an editable copy). Bodies are raw HTML or Markdown — template authors work in whichever they prefer. */
function TemplatesManager({ canManage, onClose }: { canManage: boolean; onClose: () => void }) {
  const [list, setList] = useState<QuillTemplateSummary[]>([]);
  const [selected, setSelected] = useState<QuillTemplate | null>(null);
  const [name, setName] = useState("");
  const [format, setFormat] = useState<"html" | "md">("html");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    api.get<QuillTemplateSummary[]>("/tenant/quill/templates").then((r) => setList(r.data)).catch(() => setList([]));
  }, []);
  useEffect(() => reload(), [reload]);

  function startNew() {
    setSelected(null);
    setName("");
    setFormat("html");
    setBody("");
  }

  async function open(id: string) {
    const r = await api.get<QuillTemplate>(`/tenant/quill/templates/${id}`);
    setSelected(r.data);
    setName(r.data.name);
    setFormat(r.data.format);
    setBody(r.data.body);
  }

  async function save() {
    setBusy(true);
    try {
      if (selected && !selected.is_builtin) {
        await api.put(`/tenant/quill/templates/${selected.id}`, { name, body });
        toast.success("Template updated");
      } else {
        // New template, or a duplicate of a built-in.
        await api.post("/tenant/quill/templates", { name: name || "Untitled template", format, body });
        toast.success("Template created");
        startNew();
      }
      reload();
    } catch {
      toast.error("Couldn't save the template.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this template?")) return;
    await api.delete(`/tenant/quill/templates/${id}`);
    if (selected?.id === id) startNew();
    reload();
  }

  const editingBuiltin = selected?.is_builtin ?? false;

  return (
    <Modal open onClose={onClose}>
      <div className="max-h-[85vh] overflow-hidden rounded-xl border border-ink-600 bg-gradient-to-b from-ink-800 to-ink-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-ink-700 px-5 py-3">
          <p className="font-display text-lg text-[#f5eee0]">Proposal templates</p>
          <button onClick={onClose} className="text-sm text-[#8a7f6d] hover:text-gold-300">Close ✕</button>
        </div>
        <div className="grid grid-cols-[240px_1fr] gap-0" style={{ maxHeight: "72vh" }}>
          <div className="overflow-y-auto border-r border-ink-700 p-3">
            <Button className="mb-2 w-full py-1.5 text-xs" onClick={startNew}>+ New template</Button>
            {list.map((t) => (
              <button
                key={t.id}
                onClick={() => open(t.id)}
                className={`mb-1 flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-sm ${
                  selected?.id === t.id ? "bg-gold-500/15 text-gold-100" : "text-[#d8cdb9] hover:bg-ink-800"
                }`}
              >
                <span className="truncate">{t.name}</span>
                <span className="ml-2 shrink-0 text-[10px] uppercase text-[#8a7f6d]">{t.is_builtin ? "built-in" : t.format}</span>
              </button>
            ))}
          </div>
          <div className="overflow-y-auto p-4">
            {editingBuiltin && (
              <p className="mb-3 rounded-md border border-gold-700/40 bg-gold-500/[0.06] px-3 py-2 text-xs text-gold-200">
                Built-in template — read-only. Edit the name/body and “Save as new” to make your own editable copy.
              </p>
            )}
            <div className="grid gap-3">
              <div className="grid grid-cols-[1fr_auto] gap-3">
                <div>
                  <Label>Name</Label>
                  <Input value={name} disabled={!canManage} onChange={(e) => setName(e.target.value)} placeholder="Template name" />
                </div>
                <div>
                  <Label>Format</Label>
                  <select
                    value={format}
                    disabled={!canManage || (!!selected && !editingBuiltin)}
                    onChange={(e) => setFormat(e.target.value as "html" | "md")}
                    className="rounded-md border border-ink-600 bg-ink-900 px-3 py-2.5 text-sm text-[#ede6da] outline-none focus:border-gold-500"
                  >
                    <option value="html">HTML</option>
                    <option value="md">Markdown</option>
                  </select>
                </div>
              </div>
              <div>
                <Label>Body ({format === "md" ? "Markdown" : "HTML"})</Label>
                <textarea
                  value={body}
                  disabled={!canManage}
                  onChange={(e) => setBody(e.target.value)}
                  rows={14}
                  placeholder={format === "md" ? "# Proposal for [client]\n\n## Overview\n…" : "<h1>Proposal for [client]</h1>\n<p>…</p>"}
                  className="w-full rounded-md border border-ink-600 bg-ink-900 px-3 py-2 font-mono text-xs text-[#ede6da] outline-none focus:border-gold-500"
                />
                <p className="mt-1 text-[11px] text-[#8a7f6d]">Use bracketed placeholders like [client name] — Quill fills them from your notes when generating.</p>
              </div>
              {canManage && (
                <div className="flex items-center gap-2">
                  <Button className="px-4 py-2 text-xs" disabled={busy} onClick={save}>
                    {selected && !editingBuiltin ? "Save changes" : "Save as new"}
                  </Button>
                  {selected && !editingBuiltin && (
                    <Button className="px-4 py-2 text-xs" variant="ghost" disabled={busy} onClick={() => remove(selected.id)}>Delete</Button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
