import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { api, type PublicSignEnvelope, type PublicSignResult } from "../lib/api";

/** The public, unauthenticated signing page (route: /sign/:token). A signer opens the emailed link,
 * reviews the document, and signs — no login. Uses the shared axios instance, which omits the bearer
 * header when no token is stored. Deliberately plain and standalone (no HQ shell). */
export default function SignContract() {
  const { token } = useParams<{ token: string }>();
  const [env, setEnv] = useState<PublicSignEnvelope | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PublicSignResult | null>(null);
  const [name, setName] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [drawn, setDrawn] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    api.get<PublicSignEnvelope>(`/sign/${token}`)
      .then((r) => { setEnv(r.data); setName(r.data.signer_name || ""); })
      .catch((e) => setError(e?.response?.data?.detail || "This signing link is not valid."));
  }, [token]);

  async function sign() {
    if (!token) return;
    if (!name.trim()) { setError("Please type your full name."); return; }
    if (!agree) { setError("Please tick the box to agree to sign electronically."); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<PublicSignResult>(`/sign/${token}`, {
        signature_name: name.trim(), agree, signature_image_data_uri: drawn,
      });
      setResult(r.data);
    } catch (e) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Couldn't record your signature.");
    } finally {
      setBusy(false);
    }
  }

  async function decline() {
    if (!token) return;
    const reason = window.prompt("Optionally, tell the sender why you're declining:") ?? "";
    setBusy(true);
    try {
      const r = await api.post<PublicSignResult>(`/sign/${token}/decline`, { reason });
      setResult(r.data);
    } catch (e) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Couldn't record your response.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f4f2ee", color: "#1a1a1a", fontFamily: "Arial, Helvetica, sans-serif" }}>
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "24px 16px 64px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
          <span style={{ fontSize: 22 }}>🖋️</span>
          <strong style={{ fontSize: 18 }}>Signet</strong>
          <span style={{ color: "#888", fontSize: 13 }}>secure e-signature</span>
        </div>

        {error && !env && (
          <div style={{ background: "#fff", border: "1px solid #e5e2dc", borderRadius: 10, padding: 32, textAlign: "center" }}>
            <p style={{ fontSize: 16 }}>{error}</p>
          </div>
        )}

        {result ? (
          <div style={{ background: "#fff", border: "1px solid #e5e2dc", borderRadius: 10, padding: 40, textAlign: "center" }}>
            <p style={{ fontSize: 40, marginBottom: 8 }}>{result.status === "declined" ? "✋" : "✅"}</p>
            <h2 style={{ margin: "0 0 8px" }}>{result.status === "declined" ? "Declined" : result.status === "completed" ? "Fully signed" : "Signed"}</h2>
            <p style={{ color: "#555" }}>{result.message}</p>
          </div>
        ) : env ? (
          env.status === "unavailable" ? (
            <div style={{ background: "#fff", border: "1px solid #e5e2dc", borderRadius: 10, padding: 32, textAlign: "center" }}>
              <p style={{ fontSize: 16 }}>{env.already_signed ? "You've already signed this document." : "This document is no longer available for signing."}</p>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 16 }}>
              <div style={{ background: "#fff", border: "1px solid #e5e2dc", borderRadius: 10, padding: 20 }}>
                <h1 style={{ fontSize: 20, margin: "0 0 6px" }}>{env.title}</h1>
                {env.message && <p style={{ color: "#555", margin: "0 0 4px" }}>{env.message}</p>}
                <p style={{ color: "#888", fontSize: 13, margin: 0 }}>Requested signature from <strong>{env.signer_name}</strong></p>
              </div>

              {env.document_data_uri && (
                <iframe title="Document" src={env.document_data_uri} style={{ width: "100%", height: 560, border: "1px solid #e5e2dc", borderRadius: 10, background: "#fff" }} />
              )}

              <div style={{ background: "#fff", border: "1px solid #e5e2dc", borderRadius: 10, padding: 20, display: "grid", gap: 12 }}>
                <div>
                  <label style={{ display: "block", fontSize: 13, color: "#555", marginBottom: 4 }}>Type your full name to sign</label>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name"
                    style={{ width: "100%", padding: "10px 12px", border: "1px solid #cfccc4", borderRadius: 8, fontSize: 15 }} />
                </div>
                <SignaturePad onChange={setDrawn} />
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
                  <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                  I agree to sign this document electronically, and this constitutes my legal signature.
                </label>
                {error && <p style={{ color: "#b00", fontSize: 13, margin: 0 }}>{error}</p>}
                <div style={{ display: "flex", gap: 10 }}>
                  <button onClick={sign} disabled={busy}
                    style={{ background: "#1e3a5f", color: "#fff", border: 0, borderRadius: 8, padding: "10px 20px", fontSize: 15, cursor: "pointer" }}>
                    {busy ? "…" : "Sign document"}
                  </button>
                  <button onClick={decline} disabled={busy}
                    style={{ background: "transparent", color: "#888", border: "1px solid #cfccc4", borderRadius: 8, padding: "10px 20px", fontSize: 14, cursor: "pointer" }}>
                    Decline
                  </button>
                </div>
              </div>
            </div>
          )
        ) : (
          !error && <p style={{ color: "#888" }}>Loading…</p>
        )}
      </div>
    </div>
  );
}

/** A tiny canvas signature pad (optional). Exports a PNG data URI on change; clearing resets to null. */
function SignaturePad({ onChange }: { onChange: (dataUri: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [has, setHas] = useState(false);

  const pos = useCallback((e: React.PointerEvent) => {
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  function start(e: React.PointerEvent) {
    drawing.current = true;
    const ctx = canvasRef.current!.getContext("2d")!;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  }
  function move(e: React.PointerEvent) {
    if (!drawing.current) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    if (!has) setHas(true);
  }
  function end() {
    if (!drawing.current) return;
    drawing.current = false;
    if (has) onChange(canvasRef.current!.toDataURL("image/png"));
  }
  function clear() {
    const c = canvasRef.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setHas(false);
    onChange(null);
  }

  return (
    <div>
      <label style={{ display: "block", fontSize: 13, color: "#555", marginBottom: 4 }}>Draw your signature (optional)</label>
      <canvas ref={canvasRef} width={520} height={120}
        onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end}
        style={{ width: "100%", maxWidth: 520, height: 120, border: "1px dashed #cfccc4", borderRadius: 8, background: "#fafafa", touchAction: "none" }} />
      {has && <button onClick={clear} style={{ marginTop: 4, background: "transparent", border: 0, color: "#888", fontSize: 12, cursor: "pointer" }}>Clear</button>}
    </div>
  );
}
