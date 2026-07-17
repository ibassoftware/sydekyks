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

type ReadinessStatus = "checking" | "ready" | "not_configured" | "not_ready" | "unavailable" | "no_access";

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
  not_configured: "border-warning bg-warning-soft text-warning-fg",
  not_ready: "border-warning bg-warning-soft text-warning-fg",
  unavailable: "border-ink-600 bg-ink-800 text-body",
  no_access: "border-ink-600 bg-ink-800 text-body",
};

const STATUS_LABEL: Record<ReadinessStatus, string> = {
  checking: "Checking readiness",
  ready: "Ready for orders",
  not_configured: "Not configured",
  not_ready: "Not ready",
  unavailable: "Readiness unavailable",
  no_access: "Commander access required",
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

  async function uploadBills(files: File[]) {
    if (!files.length) return;
    setBusy(true);
    try {
      const form = new FormData();
      files.forEach((file) => form.append("files", file));
      await api.post(`/tenant/sydekyks/${agent.id}/documents`, form);
      toast.success(`${files.length} bill${files.length === 1 ? "" : "s"} dispatched to Ledger.`);
    } catch {
      toast.error("Ledger could not accept those bills.");
    } finally {
      setBusy(false);
    }
  }

  function dropBills(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setDragging(false);
    if (!busy) uploadBills(Array.from(event.dataTransfer.files));
  }

  const ready = status === "ready";
  const checking = status === "checking";
  const actionVisible = ready || checking;
  const setupHref = `/hq/roster/${agent.id}?tab=settings`;

  return (
    <div className="mt-auto pt-5">
      <div className={`inline-flex items-center gap-2 rounded-[2px] border-2 px-2 py-1 text-xs font-medium ${STATUS_STYLE[status]}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${ready ? "bg-success" : status === "checking" ? "bg-body" : "bg-warning"}`} aria-hidden="true" />
        {STATUS_LABEL[status]}
      </div>

      {!actionVisible ? (
        <div className="mt-3 rounded-[4px] border-2 border-ink-700 bg-ink-900/50 p-3">
          {detail && <p className="line-clamp-2 text-xs leading-5 text-body">{detail}</p>}
          {agent.can_configure && (
            <Link to={setupHref} className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-gold-300 hover:text-heading">
              Open setup →
            </Link>
          )}
        </div>
      ) : agent.slug === "ledger" ? (
        <div className="mt-3">
          <button
            type="button"
            disabled={busy || !ready}
            onClick={() => fileRef.current?.click()}
            onDragOver={(event) => { event.preventDefault(); if (!busy) setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={dropBills}
            className={`flex min-h-24 w-full flex-col items-center justify-center rounded-[4px] border-2 border-dashed px-4 py-3 text-center transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${dragging ? "border-gold-400 bg-brand-softer" : "border-ink-600 bg-ink-900/50 hover:border-gold-500 hover:bg-ink-800"}`}
          >
            <span className="text-sm font-medium text-heading">{busy ? "Dispatching bills…" : "Drop bills to begin"}</span>
            <span className="mt-1 text-xs text-body">{checking ? "Confirming Ledger readiness…" : "or browse PDF, PNG, JPG, WEBP"}</span>
          </button>
          <input ref={fileRef} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp" className="hidden" onChange={(event) => { uploadBills(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
        </div>
      ) : agent.slug === "decode" ? (
        ready
          ? <Link to={`/hq/roster/${agent.id}`} className={buttonClassName("primary", "mt-3 w-full text-sm")}>Upload résumés</Link>
          : <Button className="mt-3 w-full text-sm" disabled>Upload résumés</Button>
      ) : agent.slug === "quill" ? (
        <Button className="mt-3 w-full text-sm" disabled={busy || !ready} onClick={() => createDocument("proposal")}>{busy ? "Opening workbench…" : "Start a proposal"}</Button>
      ) : agent.slug === "seal" ? (
        <Button className="mt-3 w-full text-sm" disabled={busy || !ready} onClick={() => createDocument("contract")}>{busy ? "Opening workbench…" : "Start a contract"}</Button>
      ) : agent.slug === "signet" ? (
        ready
          ? <Link to={`/hq/roster/${agent.id}?new=1`} className={buttonClassName("primary", "mt-3 w-full text-sm")}>Prepare an envelope</Link>
          : <Button className="mt-3 w-full text-sm" disabled>Prepare an envelope</Button>
      ) : RUN_ACTIONS[agent.slug] ? (
        <Button className="mt-3 w-full text-sm" disabled={!ready || busy || working} onClick={runNow}>
          {working ? "Mission underway" : busy ? RUN_ACTIONS[agent.slug].runningLabel : RUN_ACTIONS[agent.slug].label}
        </Button>
      ) : (
        ready
          ? <Link to={`/hq/roster/${agent.id}`} className={buttonClassName("primary", "mt-3 w-full text-sm")}>Enter command post</Link>
          : <Button className="mt-3 w-full text-sm" disabled>Enter command post</Button>
      )}
    </div>
  );
}
