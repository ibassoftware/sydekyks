import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { marked } from "marked";
import { api, type SealContract, type SealContractPage, type SealContractSummary, type SealTemplate, type SealTemplateSummary } from "../../lib/api";
import { Button, Input, Label, Modal } from "../../components/ui";
import { toast } from "../../lib/toast";
import type { OperationsProps } from "../registry";

/** Seal's operations panel - the workbench entry point. Create a contract (blank or from a template)
 * and jump into the editor, import a counterparty contract to review, and reopen recent contracts. */
export function SealOperationsSection({ canManage }: OperationsProps) {
  const navigate = useNavigate();
  const [page, setPage] = useState<SealContractPage | null>(null);
  const [templates, setTemplates] = useState<SealTemplateSummary[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    api.get<SealContractPage>("/tenant/seal/contracts", { params: { limit: 20 } }).then((r) => setPage(r.data)).catch(() => setPage(null));
  }, []);
  const loadTemplates = useCallback(() => {
    api.get<SealTemplateSummary[]>("/tenant/seal/templates").then((r) => setTemplates(r.data)).catch(() => setTemplates([]));
  }, []);

  useEffect(() => { load(); loadTemplates(); }, [load, loadTemplates]);

  async function newContract() {
    setCreating(true);
    try {
      const r = await api.post<SealContractSummary>("/tenant/seal/contracts", { title: "Untitled contract", from_template_id: templateId || null });
      if (templateId) {
        try {
          const tpl = await api.get<SealTemplate>(`/tenant/seal/templates/${templateId}`);
          if (tpl.data.format === "md" && tpl.data.body) {
            const html = await marked.parse(tpl.data.body);
            await api.put(`/tenant/seal/contracts/${r.data.id}`, { content_html: html });
          }
        } catch { /* non-fatal - Generate can fill it from the template */ }
      }
      navigate(`/hq/seal/editor/${r.data.id}`);
    } finally {
      setCreating(false);
    }
  }

  async function importForReview(file: File) {
    setImporting(true);
    try {
      const created = await api.post<SealContractSummary>("/tenant/seal/contracts", { title: file.name.replace(/\.[^.]+$/, "") });
      const form = new FormData();
      form.append("file", file);
      await api.post<{ contract: SealContract }>(`/tenant/seal/contracts/${created.data.id}/import`, form);
      toast.success("Imported - opening for review");
      navigate(`/hq/seal/editor/${created.data.id}`);
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail || "Couldn't import that file - try pasting the text instead.");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this contract?")) return;
    await api.delete(`/tenant/seal/contracts/${id}`);
    load();
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">New Contract</p>
          <p className="mt-1 text-sm text-[#8a7f6d]">Start blank or from a template, then draft, review, and export in the workbench.</p>
        </div>
        {canManage && (
          <div className="flex flex-wrap items-end gap-2">
            <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="rounded-md border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-[#ede6da] outline-none focus:border-gold-500">
              <option value="">Blank</option>
              {templates.map((t) => (<option key={t.id} value={t.id}>{t.name}{t.is_builtin ? " (built-in)" : ""}</option>))}
            </select>
            <Button className="px-4 py-2 text-xs" variant="ghost" onClick={() => setShowTemplates(true)}>Manage templates</Button>
            <Button className="px-4 py-2 text-xs" variant="ghost" disabled={importing} onClick={() => fileRef.current?.click()}>{importing ? "Importing…" : "Import for review"}</Button>
            <input ref={fileRef} type="file" accept="application/pdf,.pdf,.docx,.txt" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importForReview(f); }} />
            <Button className="px-4 py-2 text-xs" disabled={creating} onClick={newContract}>{creating ? "Creating…" : "New contract"}</Button>
          </div>
        )}
      </div>

      {showTemplates && <TemplatesManager canManage={canManage} onClose={() => { setShowTemplates(false); loadTemplates(); }} />}

      <div className="mt-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">{page?.sees_all ? "All Contracts" : "Your Contracts"}</p>
        {page?.sees_all && <p className="-mt-0.5 text-[11px] text-[#8a7f6d]">You can see every contract in this HQ. Drafters see only their own.</p>}
        {!page ? (
          <p className="mt-2 text-sm text-[#8a7f6d]">Loading…</p>
        ) : page.items.length === 0 ? (
          <p className="mt-2 text-sm text-[#8a7f6d]">No contracts yet - create one to get started.</p>
        ) : (
          <div className="mt-2 grid gap-2">
            {page.items.map((c) => (
              <div key={c.id} className="flex items-center gap-3 rounded-lg border border-ink-700 px-3 py-2 hover:border-gold-600/40">
                <button onClick={() => navigate(`/hq/seal/editor/${c.id}`)} className="min-w-0 flex-1 text-left">
                  <span className="text-sm text-[#ede6da]">{c.title}</span>
                  {c.counterparty_name && <span className="ml-2 text-xs text-[#8a7f6d]">· {c.counterparty_name}</span>}
                  {page.sees_all && c.owned_by && <span className="ml-2 text-[11px] text-[#7a7060]"> -  {c.owned_by}</span>}
                </button>
                {c.open_findings > 0 && <span className="rounded-full border border-amber-500/50 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-200">{c.open_findings} open</span>}
                <span className={`rounded-full border px-2 py-0.5 text-[11px] ${c.status === "final" ? "border-gold-600/50 bg-gold-500/10 text-gold-300" : "border-ink-600 bg-ink-800/60 text-[#b9ad98]"}`}>{c.status}</span>
                <button onClick={() => navigate(`/hq/seal/editor/${c.id}`)} className="shrink-0 text-xs font-semibold text-gold-400 hover:text-gold-300">Open</button>
                {canManage && <button onClick={() => remove(c.id)} className="shrink-0 text-xs font-semibold text-red-300/80 hover:text-red-300">Delete</button>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TemplatesManager({ canManage, onClose }: { canManage: boolean; onClose: () => void }) {
  const [list, setList] = useState<SealTemplateSummary[]>([]);
  const [selected, setSelected] = useState<SealTemplate | null>(null);
  const [name, setName] = useState("");
  const [format, setFormat] = useState<"html" | "md">("html");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    api.get<SealTemplateSummary[]>("/tenant/seal/templates").then((r) => setList(r.data)).catch(() => setList([]));
  }, []);
  useEffect(() => reload(), [reload]);

  function startNew() { setSelected(null); setName(""); setFormat("html"); setBody(""); }

  async function open(id: string) {
    const r = await api.get<SealTemplate>(`/tenant/seal/templates/${id}`);
    setSelected(r.data); setName(r.data.name); setFormat(r.data.format); setBody(r.data.body);
  }

  async function save() {
    setBusy(true);
    try {
      if (selected && !selected.is_builtin) {
        await api.put(`/tenant/seal/templates/${selected.id}`, { name, body });
        toast.success("Template updated");
      } else {
        await api.post("/tenant/seal/templates", { name: name || "Untitled template", format, body });
        toast.success("Template created");
        startNew();
      }
      reload();
    } catch { toast.error("Couldn't save the template."); } finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this template?")) return;
    await api.delete(`/tenant/seal/templates/${id}`);
    if (selected?.id === id) startNew();
    reload();
  }

  const editingBuiltin = selected?.is_builtin ?? false;

  return (
    <Modal open onClose={onClose}>
      <div className="max-h-[85vh] overflow-hidden rounded-xl border border-ink-600 bg-gradient-to-b from-ink-800 to-ink-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-ink-700 px-5 py-3">
          <p className="font-display text-lg text-[#f5eee0]">Contract templates</p>
          <button onClick={onClose} className="text-sm text-[#8a7f6d] hover:text-gold-300">Close ✕</button>
        </div>
        <div className="grid grid-cols-[240px_1fr] gap-0" style={{ maxHeight: "72vh" }}>
          <div className="overflow-y-auto border-r border-ink-700 p-3">
            <Button className="mb-2 w-full py-1.5 text-xs" onClick={startNew}>+ New template</Button>
            {list.map((t) => (
              <button key={t.id} onClick={() => open(t.id)} className={`mb-1 flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-sm ${selected?.id === t.id ? "bg-gold-500/15 text-gold-100" : "text-[#d8cdb9] hover:bg-ink-800"}`}>
                <span className="truncate">{t.name}</span>
                <span className="ml-2 shrink-0 text-[10px] uppercase text-[#8a7f6d]">{t.is_builtin ? "built-in" : t.format}</span>
              </button>
            ))}
          </div>
          <div className="overflow-y-auto p-4">
            {editingBuiltin && <p className="mb-3 rounded-md border border-gold-700/40 bg-gold-500/[0.06] px-3 py-2 text-xs text-gold-200">Built-in template - read-only. Edit the name/body and “Save as new” to make your own editable copy.</p>}
            <div className="grid gap-3">
              <div className="grid grid-cols-[1fr_auto] gap-3">
                <div>
                  <Label>Name</Label>
                  <Input value={name} disabled={!canManage} onChange={(e) => setName(e.target.value)} placeholder="Template name" />
                </div>
                <div>
                  <Label>Format</Label>
                  <select value={format} disabled={!canManage || (!!selected && !editingBuiltin)} onChange={(e) => setFormat(e.target.value as "html" | "md")} className="rounded-md border border-ink-600 bg-ink-900 px-3 py-2.5 text-sm text-[#ede6da] outline-none focus:border-gold-500">
                    <option value="html">HTML</option>
                    <option value="md">Markdown</option>
                  </select>
                </div>
              </div>
              <div>
                <Label>Body ({format === "md" ? "Markdown" : "HTML"})</Label>
                <textarea value={body} disabled={!canManage} onChange={(e) => setBody(e.target.value)} rows={14} placeholder={format === "md" ? "# Service Agreement\n\n## 1. Services\n…" : "<h1>Service Agreement</h1>\n<p>…</p>"} className="w-full rounded-md border border-ink-600 bg-ink-900 px-3 py-2 font-mono text-xs text-[#ede6da] outline-none focus:border-gold-500" />
                <p className="mt-1 text-[11px] text-[#8a7f6d]">Use bracketed placeholders like [confirm client] - Seal fills them from your brief when drafting.</p>
              </div>
              {canManage && (
                <div className="flex items-center gap-2">
                  <Button className="px-4 py-2 text-xs" disabled={busy} onClick={save}>{selected && !editingBuiltin ? "Save changes" : "Save as new"}</Button>
                  {selected && !editingBuiltin && <Button className="px-4 py-2 text-xs" variant="ghost" disabled={busy} onClick={() => remove(selected.id)}>Delete</Button>}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
