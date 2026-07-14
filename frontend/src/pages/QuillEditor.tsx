import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  api,
  type QuillAsset,
  type QuillChatHistory,
  type QuillChatMessage,
  type QuillChatResult,
  type QuillOpportunity,
  type QuillProposal,
  type QuillQuotation,
  type QuillTemplateSummary,
} from "../lib/api";
import { HQShell } from "../components/HQShell";
import { RichDocEditor } from "../components/RichDocEditor";
import { Button, Input, Label } from "../components/ui";
import { toast } from "../lib/toast";

function fmtTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

export default function QuillEditor() {
  const { proposalId } = useParams<{ proposalId: string }>();
  const navigate = useNavigate();
  const [proposal, setProposal] = useState<QuillProposal | null>(null);
  const [title, setTitle] = useState("");
  const [html, setHtml] = useState("");
  const [saving, setSaving] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [tokenTotal, setTokenTotal] = useState(0);
  const [cost, setCost] = useState(0);
  const [quillHref, setQuillHref] = useState("/hq/roster");
  const undoRef = useRef<string | null>(null);

  // Resolve the Quill agent page so the editor can jump back to its settings/operations.
  useEffect(() => {
    api.get<{ id: string; slug: string }[]>("/tenant/sydekyks")
      .then((r) => {
        const q = r.data.find((s) => s.slug === "quill");
        if (q) setQuillHref(`/hq/roster/${q.id}`);
      })
      .catch(() => {});
  }, []);

  const load = useCallback(() => {
    if (!proposalId) return;
    api.get<QuillProposal>(`/tenant/quill/proposals/${proposalId}`)
      .then((r) => {
        setProposal(r.data);
        setTitle(r.data.title);
        setHtml(r.data.content_html);
        setTokenTotal(r.data.token_total);
        setCost(r.data.cost_usd);
      })
      .catch(() => setNotFound(true));
  }, [proposalId]);

  useEffect(() => load(), [load]);

  // Debounced autosave of title + content.
  const dirtyRef = useRef(false);
  useEffect(() => {
    if (!proposal || !dirtyRef.current) return;
    const t = setTimeout(() => save(), 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, title]);

  async function save() {
    if (!proposalId) return;
    setSaving(true);
    try {
      await api.put(`/tenant/quill/proposals/${proposalId}`, { title, content_html: html });
      dirtyRef.current = false;
    } finally {
      setSaving(false);
    }
  }

  async function onInsertImage(file: File): Promise<string | null> {
    if (!proposalId) return null;
    const form = new FormData();
    form.append("file", file);
    try {
      const r = await api.post<QuillAsset>(`/tenant/quill/proposals/${proposalId}/assets`, form);
      return r.data.data_uri;
    } catch (e) {
      toast.error(errMsg(e, "Couldn't upload the image."));
      return null;
    }
  }

  function applyRewrite(newHtml: string, tokens: number, newCost: number) {
    undoRef.current = html;
    setHtml(newHtml);
    dirtyRef.current = true;
    setTokenTotal(tokens);
    setCost(newCost);
  }

  function undoRevision() {
    if (undoRef.current === null) return;
    setHtml(undoRef.current);
    undoRef.current = null;
    dirtyRef.current = true;
  }

  async function exportPdf(merge: boolean) {
    if (!proposalId) return;
    try {
      const r = await api.post(`/tenant/quill/proposals/${proposalId}/pdf`, null, {
        params: merge ? { merge_quotation: true } : undefined,
        responseType: "blob",
      });
      const url = URL.createObjectURL(r.data as Blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${title || "proposal"}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(errMsg(e, "PDF export failed."));
    }
  }

  async function saveAsTemplate() {
    const name = window.prompt("Name this template:", `${title} template`);
    if (!name) return;
    try {
      await api.post("/tenant/quill/templates", { name, format: "html", body: html });
      toast.success("Saved as template");
    } catch (e) {
      toast.error(errMsg(e, "Couldn't save the template."));
    }
  }

  if (notFound) {
    return (
      <HQShell>
        <div className="p-10 text-center text-[#8a7f6d]">
          Proposal not found. <button className="text-gold-400 underline" onClick={() => navigate("/hq/roster")}>Back to roster</button>
        </div>
      </HQShell>
    );
  }

  return (
    <HQShell>
      <div className="flex h-screen flex-col">
        {/* Top bar */}
        <div className="flex flex-wrap items-center gap-3 border-b border-ink-700 bg-ink-900/60 px-6 py-3">
          <button onClick={() => navigate(quillHref)} className="text-sm text-[#8a7f6d] hover:text-gold-300" title="Back to Quill (settings & proposals)">← Quill</button>
          <input
            value={title}
            onChange={(e) => { setTitle(e.target.value); dirtyRef.current = true; }}
            className="min-w-0 flex-1 border-b border-transparent bg-transparent px-1 py-1 font-display text-lg text-[#ede6da] outline-none focus:border-gold-600"
            placeholder="Proposal title"
          />
          <span className="rounded-full border border-ink-600 bg-ink-800/60 px-2.5 py-0.5 text-[11px] text-[#b9ad98]" title="Tokens spent on this proposal (all AI turns)">
            🪙 {fmtTokens(tokenTotal)} tokens · ${cost.toFixed(3)}
          </span>
          <span className="text-xs text-[#8a7f6d]">{saving ? "Saving…" : "Saved"}</span>
          <Button className="px-3 py-1.5 text-xs" variant="ghost" onClick={saveAsTemplate}>Save as template</Button>
          <Button className="px-3 py-1.5 text-xs" onClick={() => exportPdf(false)}>Export PDF</Button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* Editor */}
          <div className="min-w-0 flex-1 overflow-hidden p-5">
            <RichDocEditor value={html} onChange={(h) => { setHtml(h); dirtyRef.current = true; }} onInsertImage={onInsertImage} />
          </div>

          {/* Right rail */}
          <div className="flex w-[380px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-ink-700 bg-ink-900/40 p-4">
            <GeneratePanel proposalId={proposalId!} onGenerated={(p) => { setHtml(p.content_html); setTitle(p.title); setTokenTotal(p.token_total); setCost(p.cost_usd); dirtyRef.current = false; }} />
            <ChatPanel
              proposalId={proposalId!}
              onRewrite={(res) => applyRewrite(res.proposal.content_html, res.proposal_token_total, res.proposal_cost_usd)}
              canUndo={undoRef.current !== null}
              onUndo={undoRevision}
            />
            <OdooPanel proposal={proposal} proposalId={proposalId!} onLinked={load} onExportMerged={() => exportPdf(true)} />
          </div>
        </div>
      </div>
    </HQShell>
  );
}

function errMsg(e: unknown, fallback: string): string {
  const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
  return detail || fallback;
}

// --- Generate panel --------------------------------------------------------------------------------

function GeneratePanel({ proposalId, onGenerated }: { proposalId: string; onGenerated: (p: QuillProposal) => void }) {
  const [templates, setTemplates] = useState<QuillTemplateSummary[]>([]);
  const [templateId, setTemplateId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [opp, setOpp] = useState<QuillOpportunity | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<QuillTemplateSummary[]>("/tenant/quill/templates").then((r) => setTemplates(r.data)).catch(() => setTemplates([]));
  }, []);

  async function generate() {
    setBusy(true);
    try {
      const r = await api.post<QuillProposal>(`/tenant/quill/proposals/${proposalId}/generate`, {
        template_id: templateId || null,
        notes,
        odoo_lead_id: opp?.id ?? null,
      });
      onGenerated(r.data);
      toast.success("Draft generated");
    } catch (e) {
      toast.error(errMsg(e, "Generation failed. Is an AI engine configured?"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-ink-700 bg-ink-900/60 p-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Generate with AI</p>
      <div className="mt-3 grid gap-2">
        <div>
          <Label>Template</Label>
          <select
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            className="w-full rounded-md border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-[#ede6da] outline-none focus:border-gold-500"
          >
            <option value="">No template — standard structure</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name}{t.is_builtin ? " (built-in)" : ""}</option>
            ))}
          </select>
        </div>
        <div>
          <Label>Your notes</Label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={5}
            placeholder="Paste your bullets / notes for the proposal…"
            className="w-full rounded-md border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-[#ede6da] outline-none focus:border-gold-500"
          />
        </div>
        <OpportunityPicker value={opp} onPick={setOpp} />
        <Button className="mt-1 py-2 text-xs" disabled={busy} onClick={generate}>
          {busy ? "Writing…" : "Generate proposal"}
        </Button>
        <p className="text-[11px] text-[#8a7f6d]">Replaces the current document. Every AI turn is metered against your token allowance.</p>
      </div>
    </section>
  );
}

// --- Ask Quill chat panel --------------------------------------------------------------------------

function ChatPanel({ proposalId, onRewrite, canUndo, onUndo }: {
  proposalId: string;
  onRewrite: (res: QuillChatResult) => void;
  canUndo: boolean;
  onUndo: () => void;
}) {
  const [messages, setMessages] = useState<QuillChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<QuillChatHistory>(`/tenant/quill/proposals/${proposalId}/chat`)
      .then((r) => setMessages(r.data.messages))
      .catch(() => setMessages([]));
  }, [proposalId]);

  async function send() {
    const msg = input.trim();
    if (!msg || busy) return;
    setBusy(true);
    setInput("");
    // optimistic user bubble
    setMessages((m) => [...m, { id: `tmp-${m.length}`, seq: m.length, role: "user", content: msg, total_tokens: 0, created_at: "" }]);
    try {
      const r = await api.post<QuillChatResult>(`/tenant/quill/proposals/${proposalId}/chat`, { message: msg });
      onRewrite(r.data);
      setMessages((m) => [...m, { id: `a-${m.length}`, seq: m.length, role: "assistant", content: r.data.changed_summary, total_tokens: r.data.turn_tokens.total_tokens, created_at: "" }]);
    } catch (e) {
      const detail = errMsg(e, "The edit failed.");
      toast.error(detail);
      setMessages((m) => m.slice(0, -1)); // roll back the optimistic bubble
      setInput(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex min-h-[280px] flex-1 flex-col rounded-xl border border-ink-700 bg-ink-900/60 p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Ask Quill</p>
        {canUndo && (
          <button onClick={onUndo} className="text-[11px] font-semibold text-gold-400 hover:text-gold-300">↶ Undo last revision</button>
        )}
      </div>
      <div className="mt-2 flex-1 space-y-2 overflow-y-auto">
        {messages.length === 0 ? (
          <p className="text-[11px] text-[#8a7f6d]">Ask Quill to revise the draft — “shorten the intro”, “add a pricing table”, “make the tone more formal”. It edits the document in place.</p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={m.role === "user" ? "text-right" : ""}>
              <span className={`inline-block max-w-[90%] rounded-lg px-2.5 py-1.5 text-xs ${
                m.role === "user" ? "bg-gold-500/15 text-gold-100" : "bg-ink-800 text-[#d8cdb9]"
              }`}>
                {m.role === "assistant" && "✒ "}{m.content}
                {m.role === "assistant" && m.total_tokens > 0 && (
                  <span className="ml-1 text-[10px] text-[#8a7f6d]">· {fmtTokens(m.total_tokens)} tok</span>
                )}
              </span>
            </div>
          ))
        )}
      </div>
      <div className="mt-2 flex items-end gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          rows={2}
          placeholder={busy ? "Quill is editing…" : "Tell Quill what to change…"}
          disabled={busy}
          className="min-w-0 flex-1 resize-none rounded-md border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-[#ede6da] outline-none focus:border-gold-500 disabled:opacity-60"
        />
        <Button className="px-3 py-2 text-xs" disabled={busy || !input.trim()} onClick={send}>{busy ? "…" : "Send"}</Button>
      </div>
    </section>
  );
}

// --- Odoo panel (all optional) ---------------------------------------------------------------------

function OdooPanel({ proposal, proposalId, onLinked, onExportMerged }: {
  proposal: QuillProposal | null;
  proposalId: string;
  onLinked: () => void;
  onExportMerged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function createQuotation() {
    setBusy(true);
    try {
      const r = await api.post<QuillQuotation>(`/tenant/quill/proposals/${proposalId}/quotation`, { lines: [] });
      toast.success(`Draft quotation ${r.data.odoo_sale_order_name ?? ""} created`);
      onLinked();
    } catch (e) {
      toast.error(errMsg(e, "Couldn't create the quotation. Link an opportunity with a customer, or connect Odoo."));
    } finally {
      setBusy(false);
    }
  }

  async function attach() {
    setBusy(true);
    try {
      await api.post(`/tenant/quill/proposals/${proposalId}/attach-to-quotation`);
      toast.success("Proposal PDF attached to the quotation");
    } catch (e) {
      toast.error(errMsg(e, "Couldn't attach the PDF."));
    } finally {
      setBusy(false);
    }
  }

  const linked = !!proposal?.odoo_sale_order_id;

  return (
    <section className="rounded-xl border border-ink-700 bg-ink-900/60 p-3">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-gold-500">Odoo quotation (optional)</span>
        <span className="text-[#8a7f6d]">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="mt-3 grid gap-2">
          {linked ? (
            <p className="text-xs text-[#d8cdb9]">Linked: <span className="text-gold-300">{proposal?.odoo_sale_order_name}</span></p>
          ) : (
            <p className="text-[11px] text-[#8a7f6d]">Raise a draft sales quotation in Odoo for this proposal’s customer (needs a linked opportunity or a connected Odoo instance).</p>
          )}
          <Button className="py-1.5 text-xs" variant="ghost" disabled={busy} onClick={createQuotation}>
            {linked ? "Re-create quotation" : "Create draft quotation"}
          </Button>
          {linked && (
            <>
              <Button className="py-1.5 text-xs" variant="ghost" disabled={busy} onClick={onExportMerged}>Export PDF + quotation (merged)</Button>
              <Button className="py-1.5 text-xs" variant="ghost" disabled={busy} onClick={attach}>Attach proposal PDF to quotation</Button>
            </>
          )}
        </div>
      )}
    </section>
  );
}

// --- Opportunity picker (grounding, optional) ------------------------------------------------------

function OpportunityPicker({ value, onPick }: { value: QuillOpportunity | null; onPick: (o: QuillOpportunity | null) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<QuillOpportunity[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [openSearch, setOpenSearch] = useState(false);

  useEffect(() => {
    if (!openSearch || value) return;
    const t = setTimeout(() => {
      setSearching(true);
      api.get<QuillOpportunity[]>("/tenant/quill/odoo/opportunities", { params: { q } })
        .then((r) => setResults(r.data))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(t);
  }, [q, value, openSearch]);

  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-gold-700/40 bg-gold-500/[0.05] px-3 py-2">
        <span className="text-xs text-[#ede6da]">{value.name ?? `Opportunity #${value.id}`}</span>
        {value.partner_name && <span className="text-[11px] text-[#8a7f6d]">· {value.partner_name}</span>}
        <button onClick={() => onPick(null)} className="ml-auto text-[11px] font-semibold text-gold-400 hover:text-gold-300">Remove</button>
      </div>
    );
  }

  if (!openSearch) {
    return (
      <button onClick={() => setOpenSearch(true)} className="rounded-md border border-dashed border-ink-600 px-3 py-1.5 text-left text-[11px] text-[#8a7f6d] hover:border-gold-600/60 hover:text-gold-300">
        + Ground in an Odoo opportunity (optional)
      </button>
    );
  }

  return (
    <div>
      <Label>Link an opportunity</Label>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search deal or customer…" />
      {searching ? (
        <p className="mt-1 text-[11px] text-[#8a7f6d]">Searching…</p>
      ) : results && results.length > 0 ? (
        <div className="mt-1 grid max-h-40 gap-1 overflow-y-auto">
          {results.map((o) => (
            <button key={o.id} onClick={() => onPick(o)} className="flex items-center gap-2 rounded-md border border-ink-700 px-2.5 py-1.5 text-left hover:border-gold-500/50 hover:bg-ink-800/60">
              <span className="text-xs text-[#ede6da]">{o.name ?? `Opportunity #${o.id}`}</span>
              {o.partner_name && <span className="text-[11px] text-[#8a7f6d]">· {o.partner_name}</span>}
            </button>
          ))}
        </div>
      ) : results ? (
        <p className="mt-1 text-[11px] text-amber-400/90">No matches (connect Odoo if this seems wrong).</p>
      ) : null}
    </div>
  );
}
