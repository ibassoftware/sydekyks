import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type Tone = "success" | "error";
interface Toast {
  id: number;
  message: string;
  tone: Tone;
}

let toasts: Toast[] = [];
let listeners: ((t: Toast[]) => void)[] = [];
let nextId = 1;

function emit() {
  for (const l of listeners) l([...toasts]);
}

function push(message: string, tone: Tone) {
  // Dedupe: a repeat of the same message just refreshes the existing toast's timer.
  toasts = toasts.filter((t) => t.message !== message);
  const id = nextId++;
  toasts = [...toasts, { id, message, tone }];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, 2500);
}

/** Fire a transient toast from anywhere (including non-React code like the axios interceptor). */
export const toast = {
  success: (message: string) => push(message, "success"),
  error: (message: string) => push(message, "error"),
};

/** Mount once near the app root. Renders the active toasts, theme-aware, bottom-right. */
export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    listeners.push(setItems);
    return () => {
      listeners = listeners.filter((l) => l !== setItems);
    };
  }, []);

  if (items.length === 0) return null;
  return createPortal(
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto animate-[fadeIn_0.15s_ease-out] rounded-full border px-4 py-2 text-sm font-semibold shadow-xl ${
            t.tone === "success"
              ? "border-gold-600/50 bg-gold-500/15 text-gold-200"
              : "border-red-700/50 bg-red-500/15 text-red-200"
          }`}
        >
          {t.tone === "success" ? "✓ " : "✗ "}
          {t.message}
        </div>
      ))}
    </div>,
    document.body,
  );
}
