import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, type SignetEnvelope, type SignetEnvelopePage, type SignetEnvelopeSummary, type SignetSendResult } from "../../lib/api";
import { Button, Input, Label } from "../../components/ui";
import { toast } from "../../lib/toast";
import type { OperationsProps } from "../registry";

function errMsg(e: unknown, fallback: string): string {
  const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
  return detail || fallback;
}

const STATUS_STYLE: Record<string, string> = {
  completed: "border-emerald-600/50 bg-emerald-500/10 text-emerald-200",
  sent: "border-gold-600/50 bg-gold-500/10 text-gold-300",
  partially_signed: "border-gold-600/50 bg-gold-500/10 text-gold-300",
  declined: "border-red-500/50 bg-red-500/10 text-red-200",
  voided: "border-ink-600 bg-ink-800/60 text-[#8a7f6d]",
  expired: "border-ink-600 bg-ink-800/60 text-[#8a7f6d]",
  draft: "border-ink-600 bg-ink-800/60 text-[#b9ad98]",
};

interface SignerRow { name: string; email: string }

export function SignetOperationsSection({ canManage }: OperationsProps) {
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState<SignetEnvelopePage | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [showBuilder, setShowBuilder] = useState(false);

  // A Seal handoff arrives as ?contract=<id>&title=<...> — open the builder prefilled.
  const contractParam = params.get("contract");
  const titleParam = params.get("title") ?? "";
  useEffect(() => { if (contractParam) setShowBuilder(true); }, [contractParam]);

  const load = useCallback(() => {
    api.get<SignetEnvelopePage>("/tenant/signet/envelopes", { params: { limit: 20 } }).then((r) => setPage(r.data)).catch(() => setPage(null));
  }, []);
  useEffect(() => load(), [load]);

  function clearHandoff() {
    if (contractParam) { params.delete("contract"); params.delete("title"); setParams(params, { replace: true }); }
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Send for Signature</p>
          <p className="mt-1 text-sm text-[#8a7f6d]">Add signatories, send a secure signing link, and track it to completion.</p>
        </div>
        {canManage && !showBuilder && <Button className="px-4 py-2 text-xs" onClick={() => setShowBuilder(true)}>New envelope</Button>}
      </div>

      {showBuilder && canManage && (
        <EnvelopeBuilder
          initialContractId={contractParam}
          initialTitle={titleParam}
          onClose={() => { setShowBuilder(false); clearHandoff(); }}
          onSent={() => { setShowBuilder(false); clearHandoff(); load(); }}
        />
      )}

      <div className="mt-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">{page?.sees_all ? "All Envelopes" : "Your Envelopes"}</p>
        {!page ? (
          <p className="mt-2 text-sm text-[#8a7f6d]">Loading…</p>
        ) : page.items.length === 0 ? (
          <p className="mt-2 text-sm text-[#8a7f6d]">No envelopes yet — create one to send a contract for signature.</p>
        ) : (
          <div className="mt-2 grid gap-2">
            {page.items.map((e) => (
              <div key={e.id} className="rounded-lg border border-ink-700">
                <button onClick={() => setOpen(open === e.id ? null : e.id)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:border-gold-600/40">
                  <span className="min-w-0 flex-1 truncate text-sm text-[#ede6da]">{e.title}</span>
                  <span className="text-[11px] text-[#8a7f6d]">{e.signed_count}/{e.signer_count} signed</span>
                  {e.hold && <span className="rounded-full border border-amber-500/50 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-200">hold</span>}
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] ${STATUS_STYLE[e.status] ?? STATUS_STYLE.draft}`}>{e.status.replace("_", " ")}</span>
                </button>
                {open === e.id && <EnvelopeDetail id={e.id} canManage={canManage} onChange={load} />}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EnvelopeBuilder({ initialContractId, initialTitle, onClose, onSent }: {
  initialContractId: string | null;
  initialTitle: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const [title, setTitle] = useState(initialTitle || "");
  const [message, setMessage] = useState("");
  const [signers, setSigners] = useState<SignerRow[]>([{ name: "", email: "" }]);
  const [order, setOrder] = useState<"parallel" | "sequential">("parallel");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const fromSeal = !!initialContractId;

  function setSigner(i: number, patch: Partial<SignerRow>) {
    setSigners((s) => s.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  }

  async function createAndSend() {
    const clean = signers.map((s) => ({ name: s.name.trim(), email: s.email.trim() })).filter((s) => s.name && s.email);
    if (clean.length === 0) { toast.error("Add at least one signer with a name and email."); return; }
    if (!fromSeal && !file) { toast.error("Attach a PDF, or start from a Seal contract."); return; }
    setBusy(true);
    try {
      const created = await api.post<SignetEnvelope>("/tenant/signet/envelopes", {
        title, message, seal_contract_id: initialContractId, signers: clean, signing_order: order,
      });
      if (!fromSeal && file) {
        const form = new FormData();
        form.append("file", file);
        await api.post(`/tenant/signet/envelopes/${created.data.id}/source`, form);
      }
      const sent = await api.post<SignetSendResult>(`/tenant/signet/envelopes/${created.data.id}/send`);
      toast.success(`Sent to ${sent.data.sent} signer${sent.data.sent === 1 ? "" : "s"}`);
      onSent();
    } catch (e) {
      toast.error(errMsg(e, "Couldn't send. Is outbound email configured?"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-gold-700/40 bg-ink-900/60 p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">New envelope</p>
        <button onClick={onClose} className="text-[11px] text-[#8a7f6d] hover:text-gold-300">Cancel</button>
      </div>
      <div className="mt-3 grid gap-3">
        <div>
          <Label>Title</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Contract title" />
        </div>
        {fromSeal ? (
          <p className="rounded-md border border-gold-700/40 bg-gold-500/[0.06] px-3 py-2 text-[11px] text-gold-200">Signing the Seal contract you handed off. The document PDF is attached automatically.</p>
        ) : (
          <div>
            <Label>Document (PDF)</Label>
            <div className="flex items-center gap-2">
              <Button className="px-3 py-1.5 text-xs" variant="ghost" onClick={() => fileRef.current?.click()}>{file ? "Change PDF" : "Choose PDF"}</Button>
              {file && <span className="text-[11px] text-[#8a7f6d]">{file.name}</span>}
              <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </div>
          </div>
        )}
        <div>
          <Label>Signers</Label>
          <div className="grid gap-2">
            {signers.map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input value={s.name} onChange={(e) => setSigner(i, { name: e.target.value })} placeholder="Full name" />
                <Input value={s.email} onChange={(e) => setSigner(i, { email: e.target.value })} placeholder="email@company.com" />
                {signers.length > 1 && <button onClick={() => setSigners((x) => x.filter((_, idx) => idx !== i))} className="shrink-0 text-xs text-red-300/80 hover:text-red-300">✕</button>}
              </div>
            ))}
            <button onClick={() => setSigners((s) => [...s, { name: "", email: "" }])} className="text-left text-[11px] font-semibold text-gold-400 hover:text-gold-300">+ Add signer</button>
          </div>
        </div>
        <div>
          <Label>Signing order</Label>
          <select value={order} onChange={(e) => setOrder(e.target.value as "parallel" | "sequential")} className="w-full rounded-md border border-ink-600 bg-ink-900 px-3 py-2.5 text-sm text-[#ede6da] outline-none focus:border-gold-500">
            <option value="parallel">Parallel — everyone signs at once</option>
            <option value="sequential">Sequential — one after another, in order</option>
          </select>
        </div>
        <div>
          <Label>Message to signers (optional)</Label>
          <textarea rows={2} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="A short note included in the invitation…" className="w-full rounded-md border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-[#ede6da] outline-none focus:border-gold-500" />
        </div>
        <Button className="py-2 text-xs" disabled={busy} onClick={createAndSend}>{busy ? "Sending…" : "Create & send"}</Button>
      </div>
    </div>
  );
}

function EnvelopeDetail({ id, canManage, onChange }: { id: string; canManage: boolean; onChange: () => void }) {
  const [env, setEnv] = useState<SignetEnvelope | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get<SignetEnvelope>(`/tenant/signet/envelopes/${id}`).then((r) => setEnv(r.data)).catch(() => setEnv(null));
  }, [id]);
  useEffect(() => load(), [load]);

  async function act(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try { await fn(); toast.success(ok); load(); onChange(); }
    catch (e) { toast.error(errMsg(e, "Action failed.")); }
    finally { setBusy(false); }
  }

  async function downloadSigned() {
    const r = await api.get(`/tenant/signet/envelopes/${id}/signed-pdf`, { responseType: "blob" });
    const url = URL.createObjectURL(r.data as Blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${env?.title || "contract"}-signed.pdf`; a.click();
    URL.revokeObjectURL(url);
  }

  if (!env) return <div className="px-3 py-2 text-[11px] text-[#8a7f6d]">Loading…</div>;

  const active = env.status === "sent" || env.status === "partially_signed";

  return (
    <div className="border-t border-ink-700 px-3 py-3">
      <div className="grid gap-2">
        {env.signers.map((s) => (
          <div key={s.id} className="flex items-center gap-2 text-xs">
            <span className="min-w-0 flex-1 truncate text-[#d8cdb9]">{s.name} <span className="text-[#7a7060]">· {s.email}</span></span>
            {s.reminder_count > 0 && <span className="text-[10px] text-[#7a7060]">{s.reminder_count} reminded</span>}
            <span className={`rounded-full border px-1.5 py-0.5 text-[10px] uppercase ${s.status === "signed" ? "border-emerald-600/50 bg-emerald-500/10 text-emerald-200" : s.status === "declined" ? "border-red-500/50 bg-red-500/10 text-red-200" : "border-ink-600 bg-ink-800/60 text-[#b9ad98]"}`}>{s.status}</span>
          </div>
        ))}
      </div>

      {canManage && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {active && <Button className="px-3 py-1.5 text-xs" variant="ghost" disabled={busy} onClick={() => act(() => api.post(`/tenant/signet/envelopes/${id}/remind`), "Reminders sent")}>Remind now</Button>}
          {active && <Button className="px-3 py-1.5 text-xs" variant="ghost" disabled={busy} onClick={() => act(() => api.post(`/tenant/signet/envelopes/${id}/hold`, { hold: !env.hold }), env.hold ? "Hold released" : "Placed on hold")}>{env.hold ? "Release hold" : "Hold"}</Button>}
          {env.status !== "completed" && env.status !== "voided" && <Button className="px-3 py-1.5 text-xs" variant="ghost" disabled={busy} onClick={() => act(() => api.post(`/tenant/signet/envelopes/${id}/void`), "Envelope voided")}>Void</Button>}
          {env.has_signed_pdf && <Button className="px-3 py-1.5 text-xs" onClick={downloadSigned}>Download signed PDF</Button>}
        </div>
      )}

      {env.events.length > 0 && (
        <div className="mt-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#7a7060]">Activity</p>
          <div className="mt-1 grid gap-0.5">
            {env.events.slice().reverse().slice(0, 12).map((ev) => (
              <p key={ev.id} className="text-[11px] text-[#8a7f6d]"><span className="text-[#b9ad98]">{ev.event_type}</span>{ev.detail ? ` — ${ev.detail}` : ""}</p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
