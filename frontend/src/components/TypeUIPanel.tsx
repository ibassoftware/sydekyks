import { useState } from "react";

const expandedStyle = {
  position: "fixed",
  left: "50%",
  bottom: 24,
  transform: "translateX(-50%)",
  zIndex: 2147483647,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  padding: "10px 16px",
  background: "rgba(0,0,0,.5)",
  color: "#fff",
  backdropFilter: "blur(8px)",
  WebkitBackdropFilter: "blur(8px)",
  borderRadius: 9999,
  font: "500 14px/20px system-ui,sans-serif",
  boxShadow: "0 10px 24px rgba(0,0,0,.25)",
  whiteSpace: "nowrap",
} as const;

const collapsedStyle = {
  position: "fixed",
  right: 24,
  bottom: 24,
  left: "auto",
  transform: "none",
  zIndex: 2147483647,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 44,
  height: 44,
  padding: 0,
  background: "rgba(0,0,0,.5)",
  color: "#fff",
  backdropFilter: "blur(8px)",
  WebkitBackdropFilter: "blur(8px)",
  borderRadius: 9999,
  font: "500 14px/20px system-ui,sans-serif",
  boxShadow: "0 10px 24px rgba(0,0,0,.25)",
  whiteSpace: "nowrap",
} as const;

export function TypeUIPanel() {
  const [minimized, setMinimized] = useState(false);

  if (minimized) {
    return (
      <div style={collapsedStyle}>
        <button
          type="button"
          aria-label="Maximize TypeUI panel"
          onClick={() => setMinimized(false)}
          style={{ display: "grid", width: 44, height: 44, placeItems: "center", border: 0, background: "transparent", cursor: "pointer" }}
        >
          <img src="https://www.typeui.sh/logo.svg" alt="TypeUI" width="18" height="18" />
        </button>
      </div>
    );
  }

  return (
    <div style={expandedStyle}>
      <img src="https://www.typeui.sh/logo.svg" alt="TypeUI" width="18" height="18" />
      <span>TypeUI</span>
      <button
        type="button"
        aria-label="Minimize TypeUI panel"
        onClick={() => setMinimized(true)}
        style={{ display: "grid", width: 24, height: 24, placeItems: "center", marginLeft: 2, border: "1px solid rgba(255,255,255,.35)", borderRadius: 9999, background: "transparent", color: "#fff", cursor: "pointer", font: "500 16px/16px system-ui,sans-serif" }}
      >
        −
      </button>
    </div>
  );
}
