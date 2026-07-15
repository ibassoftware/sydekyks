import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  api,
  type SealAsset,
  type SealChatHistory,
  type SealChatMessage,
  type SealChatResult,
  type SealContract,
  type SealFinding,
  type SealOpportunity,
  type SealReview,
  type SealSignRequest,
  type SealTemplateSummary,
} from "../lib/api";
import { HQShell } from "../components/HQShell";
import { RichDocEditor } from "../components/RichDocEditor";
import { Button, Input, Label } from "../components/ui";
import { toast } from "../lib/toast";

function fmtTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

function errMsg(e: unknown, fallback: string): string {
  const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
  return detail || fallback;
}

export default function SealEditor() {
  const { contractId } = useParams<{ contractId: string }>();
  const navigate = useNavigate();
  const [contract, setContract] = useState<SealContract | null>(null);
  const [title, setTitle] = useState("");
  const [html, setHtml] = useState("");
  const [saving, setSaving] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [tokenTotal, setTokenTotal] = useState(0);
  const [cost, setCost] = useState(0);
  const [sealHref, setSealHref] = useState("/hq/roster");
  const [signetId, setSignetId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [accent, setAccent] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const undoRef = useRef<string | null>(null);

  useEffect(() => {
    api.get<{ accent_color: string | null }>("/tenant/seal/settings")
      .then((r) => setAccent(r.data.accent_color)).catch(() => {});
  }, []);

  useEffect(() => {
    api.get<{ id: string; slug: string }[]>("/tenant/sydekyks")
      .then((r) => {
        const s = r.data.find((x) => x.slug === "seal");
        if (s) setSealHref(`/hq/roster/${s.id}`);
        const sig = r.data.find((x) => x.slug === "signet");
        if (sig) setSignetId(sig.id);
      })
      .catch(() => {});
  }, []);

  const load = useCallback(() => {
    if (!contractId) return;
    api.get<SealContract>(`/tenant/seal/contracts/${contractId}`)
      .then((r) => {
        setContract(r.data);
        setTitle(r.data.title);
        setHtml(r.data.content_html);
        setTokenTotal(r.data.token_total);
        setCost(r.data.cost_usd);
      })
      .catch(() => setNotFound(true));
  }, [contractId]);

  useEffect(() => load(), [load]);

  const dirtyRef = useRef(false);
  useEffect(() => {
    if (!contract || !dirtyRef.current) return;
    const t = setTimeout(() => save(), 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, title]);

  async function save() {
    if (!contractId) return;
    setSaving(true);
    try {
      await api.put(`/tenant/seal/contracts/${contractId}`, { title, content_html: html });
      dirtyRef.current = false;
    } finally {
      setSaving(false);
    }
  }

  async function onInsertImage(file: File): Promise<string | null> {
    if (!contractId) return null;
    const form = new FormData();
    form.append("file", file);
    try {
      const r = await api.post<SealAsset>(`/tenant/seal/contracts/${contractId}/assets`, form);
      return r.data.data_uri;
    } catch (e) {
      toast.error(errMsg(e, "Couldn't upload the image."));
      return null;
    }
  }

  function undoRevision() {
    if (undoRef.current === null) return;
    setHtml(undoRef.current);
    undoRef.current = null;
    dirtyRef.current = true;
  }

  async function preview() {
    if (!contractId) return;
    setPreviewing(true);
    try {
      if (dirtyRef.current) await save();
      const r = await api.post(`/tenant/seal/contracts/${contractId}/pdf`, null, { responseType: "blob" });
      const url = URL.createObjectURL(r.data as Blob);
      setPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return url; });
    } catch (e) {
      toast.error(errMsg(e, "Couldn't render the preview. Is WeasyPrint installed on the backend?"));
    } finally {
      setPreviewing(false);
    }
  }

  function closePreview() {
    setPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
  }

  async function exportPdf() {
    if (!contractId) return;
    try {
      if (dirtyRef.current) await save();
      const r = await api.post(`/tenant/seal/contracts/${contractId}/pdf`, null, { responseType: "blob" });
      const url = URL.createObjectURL(r.data as Blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${title || "contract"}.pdf`;
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
      await api.post("/tenant/seal/templates", { name, format: "html", body: html });
      toast.success("Saved as template");
    } catch (e) {
      toast.error(errMsg(e, "Couldn't save the template."));
    }
  }

  async function sendForSignature() {
    if (!contractId) return;
    setSigning(true);
    try {
      if (dirtyRef.current) await save();
      const r = await api.post<SealSignRequest>(`/tenant/seal/contracts/${contractId}/sign-request`);
      if (r.data.path === "odoo_sign") {
        toast.success(r.data.detail || "Sent to Odoo Sign");
        if (r.data.odoo_url) window.open(r.data.odoo_url, "_blank");
      } else {
        // Native path — hand off to Signet to collect signatories and send.
        if (signetId) {
          navigate(`/hq/roster/${signetId}?contract=${contractId}&title=${encodeURIComponent(title)}`);
        } else {
          toast.error("Install Signet to send for signature natively.");
        }
      }
    } catch (e) {
      toast.error(errMsg(e, "Couldn't start the signing flow."));
    } finally {
      setSigning(false);
    }
  }

  if (notFound) {
    return (
      <HQShell>
        <div className="p-10 text-center text-[#8a7f6d]">
          Contract not found. <button className="text-gold-400 underline" onClick={() => navigate("/hq/roster")}>Back to roster</button>
        </div>
      </HQShell>
    );
  }

  return (
    <HQShell>
      <div className="flex h-screen flex-col">
        <div className="flex flex-wrap items-center gap-3 border-b border-ink-700 bg-ink-900/60 px-6 py-3">
          <button onClick={() => navigate(sealHref)} className="text-sm text-[#8a7f6d] hover:text-gold-300" title="Back to Seal">← Seal</button>
          <input
            value={title}
            onChange={(e) => { setTitle(e.target.value); dirtyRef.current = true; }}
            className="min-w-0 flex-1 border-b border-transparent bg-transparent px-1 py-1 font-display text-lg text-[#ede6da] outline-none focus:border-gold-600"
            placeholder="Contract title"
          />
          <span className="rounded-full border border-ink-600 bg-ink-800/60 px-2.5 py-0.5 text-[11px] text-[#b9ad98]" title="Tokens spent on this contract (all AI turns)">
            🪙 {fmtTokens(tokenTotal)} tokens · ${cost.toFixed(3)}
          </span>
          <span className="text-xs text-[#8a7f6d]">{saving ? "Saving…" : "Saved"}</span>
          <Button className="px-3 py-1.5 text-xs" variant="ghost" onClick={saveAsTemplate}>Save as template</Button>
          <Button className="px-3 py-1.5 text-xs" variant="ghost" disabled={previewing} onClick={preview}>{previewing ? "Rendering…" : "Preview"}</Button>
          <Button className="px-3 py-1.5 text-xs" variant="ghost" onClick={exportPdf}>Export PDF</Button>
          <Button className="px-3 py-1.5 text-xs" disabled={signing} onClick={sendForSignature}>{signing ? "…" : "Send for signature"}</Button>
        </div>

        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1 overflow-hidden p-5">
            <RichDocEditor value={html} onChange={(h) => { setHtml(h); dirtyRef.current = true; }} onInsertImage={onInsertImage} busy={aiBusy} accent={accent} />
          </div>

          <div className="flex w-[400px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-ink-700 bg-ink-900/40 p-4">
            <GeneratePanel
              contractId={contractId!}
              hasContent={!!html.trim()}
              onBusy={setAiBusy}
              onGenerated={(c) => { setHtml(c.content_html); setTitle(c.title); setTokenTotal(c.token_total); setCost(c.cost_usd); dirtyRef.current = false; }}
            />
            <ChatPanel
              contractId={contractId!}
              onBusy={setAiBusy}
              onRewrite={(res) => { undoRef.current = html; setHtml(res.contract.content_html); dirtyRef.current = true; setTokenTotal(res.contract_token_total); setCost(res.contract_cost_usd); }}
              canUndo={undoRef.current !== null}
              onUndo={undoRevision}
            />
            <ReviewPanel
              contractId={contractId!}
              onBusy={setAiBusy}
              onApplied={(c) => { setHtml(c.content_html); dirtyRef.current = false; }}
            />
          </div>
        </div>
      </div>

      {previewUrl && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/80 backdrop-blur-sm">
          <div className="flex items-center justify-between border-b border-ink-700 bg-ink-900 px-5 py-3">
            <p className="font-display text-sm text-[#ede6da]">PDF preview — {title}</p>
            <div className="flex items-center gap-2">
              <Button className="px-3 py-1.5 text-xs" onClick={exportPdf}>Download</Button>
              <button onClick={closePreview} className="text-sm text-[#8a7f6d] hover:text-gold-300">Close ✕</button>
            </div>
          </div>
          <iframe title="Contract PDF preview" src={previewUrl} className="min-h-0 flex-1 bg-white" />
        </div>
      )}
    </HQShell>
  );
}

// --- Generate panel --------------------------------------------------------------------------------

function GeneratePanel({ contractId, hasContent, onBusy, onGenerated }: {
  contractId: string;
  hasContent: boolean;
  onBusy: (b: boolean) => void;
  onGenerated: (c: SealContract) => void;
}) {
  const [templates, setTemplates] = useState<SealTemplateSummary[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [notes, setNotes] = useState("");
  const [opp, setOpp] = useState<SealOpportunity | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(!hasContent);

  useEffect(() => {
    api.get<SealTemplateSummary[]>("/tenant/seal/templates").then((r) => setTemplates(r.data)).catch(() => setTemplates([]));
  }, []);

  async function generate() {
    setBusy(true);
    onBusy(true);
    try {
      const r = await api.post<SealContract>(`/tenant/seal/contracts/${contractId}/generate`, {
        template_id: templateId || null, notes, odoo_lead_id: opp?.id ?? null,
      });
      onGenerated(r.data);
      toast.success("Draft generated");
      setExpanded(false);
    } catch (e) {
      toast.error(errMsg(e, "Generation failed. Is an AI engine configured?"));
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }

  if (!expanded) {
    return (
      <section className="rounded-xl border border-ink-700 bg-ink-900/60 p-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Draft with AI</p>
          <Button className="px-3 py-1.5 text-xs" variant="ghost" disabled={busy} onClick={() => setExpanded(true)}>{busy ? "Writing…" : "↻ Regenerate"}</Button>
        </div>
        <p className="mt-1 text-[11px] text-[#8a7f6d]">Regenerate replaces the document. Refine instead with “Ask Seal” below to keep your edits.</p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-ink-700 bg-ink-900/60 p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Draft with AI</p>
        {hasContent && <button onClick={() => setExpanded(false)} className="text-[11px] text-[#8a7f6d] hover:text-gold-300">Collapse</button>}
      </div>
      <div className="mt-3 grid gap-2">
        <div>
          <Label>Template</Label>
          <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="w-full rounded-md border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-[#ede6da] outline-none focus:border-gold-500">
            <option value="">No template — standard structure</option>
            {templates.map((t) => (<option key={t.id} value={t.id}>{t.name}{t.is_builtin ? " (built-in)" : ""}</option>))}
          </select>
        </div>
        <div>
          <Label>Your brief</Label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={5} placeholder="e.g. Mutual NDA with Acme Corp, 2-year term, governed by California law…" className="w-full rounded-md border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-[#ede6da] outline-none focus:border-gold-500" />
        </div>
        <OpportunityPicker value={opp} onPick={setOpp} />
        <Button className="mt-1 py-2 text-xs" disabled={busy} onClick={generate}>{busy ? "Writing…" : "Draft contract"}</Button>
        <p className="text-[11px] text-[#8a7f6d]">Replaces the current document. Every AI turn is metered against your token allowance.</p>
      </div>
    </section>
  );
}

// --- Ask Seal chat panel ---------------------------------------------------------------------------

function ChatPanel({ contractId, onBusy, onRewrite, canUndo, onUndo }: {
  contractId: string;
  onBusy: (b: boolean) => void;
  onRewrite: (res: SealChatResult) => void;
  canUndo: boolean;
  onUndo: () => void;
}) {
  const [messages, setMessages] = useState<SealChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<SealChatHistory>(`/tenant/seal/contracts/${contractId}/chat`).then((r) => setMessages(r.data.messages)).catch(() => setMessages([]));
  }, [contractId]);

  async function send() {
    const msg = input.trim();
    if (!msg || busy) return;
    setBusy(true);
    onBusy(true);
    setInput("");
    setMessages((m) => [...m, { id: `tmp-${m.length}`, seq: m.length, role: "user", content: msg, total_tokens: 0, created_at: "" }]);
    try {
      const r = await api.post<SealChatResult>(`/tenant/seal/contracts/${contractId}/chat`, { message: msg });
      onRewrite(r.data);
      setMessages((m) => [...m, { id: `a-${m.length}`, seq: m.length, role: "assistant", content: r.data.changed_summary, total_tokens: r.data.turn_tokens.total_tokens, created_at: "" }]);
    } catch (e) {
      toast.error(errMsg(e, "The edit failed."));
      setMessages((m) => m.slice(0, -1));
      setInput(msg);
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }

  return (
    <section className="flex min-h-[240px] flex-col rounded-xl border border-ink-700 bg-ink-900/60 p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Ask Seal</p>
        {canUndo && <button onClick={onUndo} className="text-[11px] font-semibold text-gold-400 hover:text-gold-300">↶ Undo last revision</button>}
      </div>
      <div className="mt-2 flex-1 space-y-2 overflow-y-auto">
        {messages.length === 0 ? (
          <p className="text-[11px] text-[#8a7f6d]">Ask Seal to revise the draft — “add a liability cap”, “make the term 3 years”, “tighten the confidentiality clause”.</p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={m.role === "user" ? "text-right" : ""}>
              <span className={`inline-block max-w-[90%] rounded-lg px-2.5 py-1.5 text-xs ${m.role === "user" ? "bg-gold-500/15 text-gold-100" : "bg-ink-800 text-[#d8cdb9]"}`}>
                {m.role === "assistant" && "✒ "}{m.content}
                {m.role === "assistant" && m.total_tokens > 0 && <span className="ml-1 text-[10px] text-[#8a7f6d]">· {fmtTokens(m.total_tokens)} tok</span>}
              </span>
            </div>
          ))
        )}
      </div>
      <div className="mt-2 flex items-end gap-2">
        <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} rows={2} placeholder={busy ? "Seal is editing…" : "Tell Seal what to change…"} disabled={busy} className="min-w-0 flex-1 resize-none rounded-md border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-[#ede6da] outline-none focus:border-gold-500 disabled:opacity-60" />
        <Button className="px-3 py-2 text-xs" disabled={busy || !input.trim()} onClick={send}>{busy ? "…" : "Send"}</Button>
      </div>
    </section>
  );
}

// --- Review panel (the wow factor) -----------------------------------------------------------------

const SEV_STYLE: Record<string, string> = {
  high: "border-red-500/50 bg-red-500/10 text-red-200",
  medium: "border-amber-500/50 bg-amber-500/10 text-amber-200",
  low: "border-ink-600 bg-ink-800/60 text-[#b9ad98]",
};

function ReviewPanel({ contractId, onBusy, onApplied }: {
  contractId: string;
  onBusy: (b: boolean) => void;
  onApplied: (c: SealContract) => void;
}) {
  const [review, setReview] = useState<SealReview | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<SealReview>(`/tenant/seal/contracts/${contractId}/findings`).then((r) => setReview(r.data)).catch(() => setReview(null));
  }, [contractId]);

  async function runReview() {
    setBusy(true);
    onBusy(true);
    try {
      const r = await api.post<SealReview>(`/tenant/seal/contracts/${contractId}/review`);
      setReview(r.data);
      toast.success(`${r.data.findings.length} finding${r.data.findings.length === 1 ? "" : "s"}${r.data.high ? ` · ${r.data.high} high` : ""}`);
    } catch (e) {
      toast.error(errMsg(e, "Review failed. Is an AI engine configured?"));
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }

  async function decide(f: SealFinding, decision: "accept" | "dismiss") {
    try {
      const r = await api.post<{ finding: SealFinding; applied: boolean; contract: SealContract }>(
        `/tenant/seal/contracts/${contractId}/findings/${f.id}/decision`, { decision },
      );
      setReview((rv) => rv ? { ...rv, findings: rv.findings.map((x) => x.id === f.id ? r.data.finding : x) } : rv);
      if (decision === "accept") {
        if (r.data.applied) { onApplied(r.data.contract); toast.success("Redline applied"); }
        else toast.success("Accepted (couldn't auto-apply — edit manually)");
      }
    } catch (e) {
      toast.error(errMsg(e, "Couldn't record the decision."));
    }
  }

  const open = review?.findings.filter((f) => f.status === "open") ?? [];

  return (
    <section className="flex flex-col rounded-xl border border-ink-700 bg-ink-900/60 p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Review contract</p>
        <Button className="px-3 py-1.5 text-xs" disabled={busy} onClick={runReview}>{busy ? "Reviewing…" : review ? "↻ Re-review" : "Review contract"}</Button>
      </div>
      {!review ? (
        <p className="mt-2 text-[11px] text-[#8a7f6d]">Seal reads the contract clause-by-clause and flags risky, one-sided, or missing clauses — with a suggested redline you accept or reject.</p>
      ) : review.findings.length === 0 ? (
        <p className="mt-2 text-[11px] text-emerald-300/80">No issues found against your review guidelines.</p>
      ) : (
        <div className="mt-3 grid gap-2">
          <p className="text-[11px] text-[#8a7f6d]">{open.length} open · {review.high} high-severity</p>
          {review.findings.map((f) => (
            <div key={f.id} className={`rounded-lg border px-3 py-2 ${f.status !== "open" ? "opacity-50" : ""}`} style={{ borderColor: "rgb(63 60 54)" }}>
              <div className="flex items-center gap-2">
                <span className={`rounded-full border px-1.5 py-0.5 text-[10px] uppercase ${SEV_STYLE[f.severity] ?? SEV_STYLE.low}`}>{f.severity}</span>
                <span className="text-xs font-semibold text-[#ede6da]">{f.clause_label || f.category}</span>
                <span className="ml-auto text-[10px] text-[#7a7060]">{f.category}</span>
              </div>
              <p className="mt-1 text-[11px] text-[#d8cdb9]">{f.issue}</p>
              {f.suggested_redline && <p className="mt-1 rounded bg-ink-800/70 px-2 py-1 text-[11px] text-emerald-200/90">Redline: {f.suggested_redline}</p>}
              {f.status === "open" ? (
                <div className="mt-2 flex gap-2">
                  <button onClick={() => decide(f, "accept")} className="text-[11px] font-semibold text-emerald-300 hover:text-emerald-200">Accept redline</button>
                  <button onClick={() => decide(f, "dismiss")} className="text-[11px] font-semibold text-[#8a7f6d] hover:text-[#b9ad98]">Dismiss</button>
                </div>
              ) : (
                <p className="mt-1 text-[10px] uppercase text-[#7a7060]">{f.status}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// --- Opportunity picker (grounding, optional) ------------------------------------------------------

function OpportunityPicker({ value, onPick }: { value: SealOpportunity | null; onPick: (o: SealOpportunity | null) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SealOpportunity[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [openSearch, setOpenSearch] = useState(false);

  useEffect(() => {
    if (!openSearch || value) return;
    const t = setTimeout(() => {
      setSearching(true);
      api.get<SealOpportunity[]>("/tenant/seal/odoo/opportunities", { params: { q } })
        .then((r) => setResults(r.data)).catch(() => setResults([])).finally(() => setSearching(false));
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
