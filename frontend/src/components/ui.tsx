import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { useEffect } from "react";
import { createPortal } from "react-dom";

export function Button({
  className = "",
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" }) {
  const base =
    "inline-flex items-center justify-center rounded-md px-5 py-2.5 text-sm font-semibold tracking-wide transition-colors disabled:opacity-50 disabled:pointer-events-none";
  const variants = {
    primary:
      "bg-gradient-to-b from-gold-400 to-gold-600 text-ink-950 hover:from-gold-300 hover:to-gold-500 shadow-[0_0_20px_-4px_rgba(212,168,40,0.6)]",
    ghost:
      "border border-gold-700/60 text-gold-300 hover:bg-ink-800 hover:border-gold-500",
  };
  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />;
}

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full rounded-md border border-ink-600 bg-ink-900 px-3.5 py-2.5 text-sm text-[#ede6da] placeholder:text-[#8a7f6d] outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500/50 ${className}`}
      {...props}
    />
  );
}

export function Card({ className = "", children, ...props }: HTMLAttributes<HTMLDivElement> & { className?: string; children: ReactNode }) {
  return (
    <div
      className={`rounded-xl border border-ink-600 bg-gradient-to-b from-ink-800 to-ink-900 shadow-xl ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-gold-400/80">{children}</label>;
}

export function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-ink-950 bg-[radial-gradient(ellipse_at_top,_var(--color-ink-800)_0%,_var(--color-ink-950)_60%)]">
      {children}
    </div>
  );
}

export function Badge({
  children,
  tone = "gold",
}: {
  children: ReactNode;
  tone?: "gold" | "neutral" | "danger";
}) {
  const tones = {
    gold: "border-gold-600/50 bg-gold-500/10 text-gold-300",
    neutral: "border-ink-600 bg-ink-700/60 text-[#b9ad98]",
    danger: "border-red-700/50 bg-red-500/10 text-red-400",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Modal({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl animate-[fadeIn_0.15s_ease-out]">{children}</div>
    </div>,
    document.body
  );
}
