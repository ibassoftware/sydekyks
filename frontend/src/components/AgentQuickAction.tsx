import { useEffect, useRef, useState, type DragEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  api,
  type AgentReadiness,
  type QuillProposalSummary,
  type RunNowResult,
  type SealContractSummary,
  type Sydekyk,
} from "../lib/api";
import { toast } from "../lib/toast";
import { Button, buttonClassName } from "./ui";

type ReadinessStatus = "checking" | "ready" | "working" | "not_configured" | "not_ready" | "unavailable" | "no_access";

const READINESS_ENDPOINTS: Record<string, string> = {
  nudge: "/tenant/nudge/readiness",
  quill: "/tenant/quill/readiness",
  seal: "/tenant/seal/readiness",
  signet: "/tenant/signet/readiness",
  ledger: "/tenant/ledger/readiness",
  mirror: "/tenant/mirror/readiness",
  shield: "/tenant/shield/readiness",
  decode: "/tenant/decode/readiness",
  scout: "/tenant/scout/readiness",
};

const RUN_ACTIONS: Record<string, { endpoint: string; label: string; runningLabel: string; result: (queued: number) => string }> = {
  nudge: {
    endpoint: "/tenant/nudge/run-now",
    label: "Check the pipeline",
    runningLabel: "Surveying the field…",
    result: (queued) => queued ? `${queued} follow-up mission${queued === 1 ? "" : "s"} dispatched.` : "The pipeline is fully tended.",
  },
  mirror: {
    endpoint: "/tenant/mirror/run-now",
    label: "Scan for duplicates",
    runningLabel: "Scanning the ledger…",
    result: (queued) => queued ? `${queued} bill${queued === 1 ? "" : "s"} sent for duplicate checks.` : "Every bill is already accounted for.",
  },
  shield: {
    endpoint: "/tenant/shield/run-now",
    label: "Assess bill risk",
    runningLabel: "Raising the shield…",
    result: (queued) => queued ? `${queued} bill${queued === 1 ? "" : "s"} sent for risk assessment.` : "No new bills need assessment.",
  },
  scout: {
    endpoint: "/tenant/scout/run-now",
    label: "Score applicants",
    runningLabel: "Scouting the field…",
    result: (queued) => queued ? `${queued} applicant${queued === 1 ? "" : "s"} sent for scoring.` : "Every applicant has already been scored.",
  },
};

const STATUS_STYLE: Record<ReadinessStatus, string> = {
  checking: "border-ink-600 bg-ink-800 text-body",
  ready: "border-success bg-success-soft text-success",
  working: "border-gold-700 bg-brand-softer text-gold-300",
  not_configured: "border-warning bg-warning-soft text-warning-fg",
  not_ready: "border-warning bg-warning-soft text-warning-fg",
  unavailable: "border-ink-600 bg-ink-800 text-body",
  no_access: "border-ink-600 bg-ink-800 text-body",
};

const STATUS_LABEL: Record<ReadinessStatus, string> = {
  checking: "Rallying systems",
  ready: "Standing ready",
  working: "Mission underway",
  not_configured: "Awaiting setup",
  not_ready: "Orders blocked",
  unavailable: "Signal unavailable",
  no_access: "Restricted command",
};

export function AgentQuickAction({
  agent,
  working,
  readiness,
}: {
  agent: Sydekyk;
  working: boolean;
  readiness?: AgentReadiness | null;
}) {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<ReadinessStatus>("checking");
  const [detail, setDetail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!agent.can_use) {
      setStatus("no_access");
      setDetail("Ask a Commander to grant access to this command post.");
      return;
    }
    const endpoint = READINESS_ENDPOINTS[agent.slug];
    if (!endpoint) {
      setStatus("ready");
      setDetail(null);
      return;
    }
    const applyReadiness = (value: AgentReadiness) => {
      const ready = value.can_upload ?? value.can_send ?? false;
      if (ready) {
        setStatus("ready");
        setDetail(null);
        return;
      }
      const blocked = value.items.filter((item) => item.state === "blocked");
      setStatus(blocked.length ? "not_configured" : "not_ready");
      setDetail(blocked[0]?.detail ?? value.items.find((item) => item.state === "warn")?.detail ?? "Finish setup before issuing an order.");
    };
    if (readiness !== undefined) {
      if (readiness) applyReadiness(readiness);
      else {
        setStatus("unavailable");
        setDetail("Open the command post to check configuration.");
      }
      return;
    }
    let current = true;
    setStatus("checking");
    api.get<AgentReadiness>(endpoint)
      .then((response) => {
        if (!current) return;
        applyReadiness(response.data);
      })
      .catch(() => {
        if (!current) return;
        setStatus("unavailable");
        setDetail("Open the command post to check configuration.");
      });
    return () => { current = false; };
  }, [agent.can_use, agent.slug, readiness]);

  async function runNow() {
    const action = RUN_ACTIONS[agent.slug];
    if (!action) return;
    setBusy(true);
    try {
      const response = await api.post<RunNowResult>(action.endpoint);
      toast.success(action.result(response.data.queued));
    } catch {
      toast.error("The mission could not be dispatched. Check this agent's setup.");
    } finally {
      setBusy(false);
    }
  }

  async function createDocument(kind: "proposal" | "contract") {
    setBusy(true);
    try {
      if (kind === "proposal") {
        const response = await api.post<QuillProposalSummary>("/tenant/quill/proposals", { title: "Untitled proposal" });
        navigate(`/hq/quill/editor/${response.data.id}`);
      } else {
        const response = await api.post<SealContractSummary>("/tenant/seal/contracts", { title: "Untitled contract" });
        navigate(`/hq/seal/editor/${response.data.id}`);
      }
    } catch {
      toast.error(`The ${kind} workbench could not be opened.`);
      setBusy(false);
    }
  }

  async function uploadDocuments(files: File[], kind: "bills" | "résumés") {
    if (!files.length) return;
    setBusy(true);
    try {
      const form = new FormData();
      files.forEach((file) => form.append("files", file));
      await api.post(`/tenant/sydekyks/${agent.id}/documents`, form);
      const singular = kind === "bills" ? "bill" : "résumé";
      toast.success(`${files.length} ${files.length === 1 ? singular : kind} dispatched to ${agent.name}.`);
    } catch {
      toast.error(`${agent.name} could not accept those ${kind}.`);
    } finally {
      setBusy(false);
    }
  }

  function dropDocuments(event: DragEvent<HTMLButtonElement>, kind: "bills" | "résumés") {
    event.preventDefault();
    setDragging(false);
    if (!busy) uploadDocuments(Array.from(event.dataTransfer.files), kind);
  }

  const ready = status === "ready";
  const checking = status === "checking";
  const actionVisible = ready || checking;
  const setupHref = `/hq/roster/${agent.id}?tab=settings`;
  const displayStatus: ReadinessStatus = working ? "working" : status;
  const uploadKind = agent.slug === "ledger" ? "bills" : "résumés";

  return (
    <div className="mt-auto flex min-h-[180px] flex-col pt-4">
      <div className="flex min-h-[116px] flex-1 flex-col justify-end">
      {!actionVisible ? (
        <div className="rounded-[4px] border-2 border-ink-700 bg-ink-900/50 p-3">
          {detail && <p className="line-clamp-2 text-xs leading-5 text-body">{detail}</p>}
          {agent.can_configure && (
            <Link to={setupHref} className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-gold-300 hover:text-heading">
              Open setup →
            </Link>
          )}
        </div>
      ) : agent.slug === "ledger" || agent.slug === "decode" ? (
        <div>
          <button
            type="button"
            disabled={busy || !ready}
            onClick={() => fileRef.current?.click()}
            onDragOver={(event) => { event.preventDefault(); if (!busy && ready) setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => dropDocuments(event, uploadKind)}
            className={`flex min-h-24 w-full flex-col items-center justify-center rounded-[4px] border-2 border-dashed px-4 py-3 text-center transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${dragging ? "border-gold-400 bg-brand-softer" : "border-ink-600 bg-ink-900/50 hover:border-gold-500 hover:bg-ink-800"}`}
          >
            <span className="text-sm font-medium text-heading">
              {busy ? `Dispatching ${uploadKind}…` : agent.slug === "ledger" ? "Drop bills to begin" : "Drop résumés to decode"}
            </span>
            <span className="mt-1 text-xs text-body">{checking ? `Confirming ${agent.name} readiness…` : "or browse PDF, PNG, JPG, WEBP"}</span>
          </button>
          <input ref={fileRef} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp" className="hidden" onChange={(event) => { uploadDocuments(Array.from(event.target.files ?? []), uploadKind); event.target.value = ""; }} />
        </div>
      ) : agent.slug === "quill" ? (
        <Button className="w-full text-sm" disabled={busy || !ready} onClick={() => createDocument("proposal")}>{busy ? "Opening workbench…" : "Start a proposal"}</Button>
      ) : agent.slug === "seal" ? (
        <Button className="w-full text-sm" disabled={busy || !ready} onClick={() => createDocument("contract")}>{busy ? "Opening workbench…" : "Start a contract"}</Button>
      ) : agent.slug === "signet" ? (
        ready
          ? <Link to={`/hq/roster/${agent.id}?new=1`} className={buttonClassName("primary", "mt-3 w-full text-sm")}>Prepare an envelope</Link>
          : <Button className="mt-3 w-full text-sm" disabled>Prepare an envelope</Button>
      ) : RUN_ACTIONS[agent.slug] ? (
        <Button className="w-full text-sm" disabled={!ready || busy || working} onClick={runNow}>
          {working ? "Mission underway" : busy ? RUN_ACTIONS[agent.slug].runningLabel : RUN_ACTIONS[agent.slug].label}
        </Button>
      ) : (
        ready
          ? <Link to={`/hq/roster/${agent.id}`} className={buttonClassName("primary", "mt-3 w-full text-sm")}>Enter command post</Link>
          : <Button className="mt-3 w-full text-sm" disabled>Enter command post</Button>
      )}
      </div>

      <div className="mt-3 flex min-h-11 items-center border-t-2 border-ink-700 pt-3">
        <div className={`inline-flex items-center gap-2 rounded-[2px] border-2 px-2 py-1 text-xs font-medium ${STATUS_STYLE[displayStatus]}`}>
          <span className={`h-2 w-2 rounded-full ${displayStatus === "ready" ? "bg-success" : displayStatus === "working" ? "animate-pulse bg-gold-300" : displayStatus === "checking" ? "bg-body" : "bg-warning"}`} aria-hidden="true" />
          {STATUS_LABEL[displayStatus]}
        </div>
      </div>
    </div>
  );
}
