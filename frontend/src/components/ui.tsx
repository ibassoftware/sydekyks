import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { useEffect } from "react";
import { createPortal } from "react-dom";

export function Button({
  className = "",
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" }) {
  return <button className={buttonClassName(variant, className)} {...props} />;
}

export function buttonClassName(variant: "primary" | "ghost" = "primary", className = "") {
  const base =
    "inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-[4px] border-2 px-5 py-2.5 text-base font-medium transition-colors disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-ink-600 disabled:bg-ink-800 disabled:text-body disabled:opacity-50 disabled:shadow-none";
  const variants = {
    primary:
      "border-transparent bg-gold-500 text-ink-950 shadow-[var(--shadow-xs),inset_var(--color-1-400)_0_6px_0_-5px,var(--color-1-700)_0_4px_10px_-5px] hover:bg-gold-600",
    ghost:
      "border-ink-600 bg-ink-800 text-body shadow-[var(--shadow-xs),inset_var(--color-1-400)_0_6px_0_-5px,var(--color-1-700)_0_4px_10px_-5px] hover:border-ink-600 hover:bg-ink-700 hover:text-heading",
  };
  return `${base} ${variants[variant]} ${className}`;
}

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full rounded-[4px] border-2 border-ink-600 bg-ink-800 px-4 py-3 text-base text-heading placeholder:text-body focus:border-gold-500 ${className}`}
      {...props}
    />
  );
}

export function Card({ className = "", children, ...props }: HTMLAttributes<HTMLDivElement> & { className?: string; children: ReactNode }) {
  return (
    <div
      className={`rounded-[4px] border-2 border-ink-600 bg-ink-900 shadow-[var(--shadow-xs)] ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <label className="mb-2 block text-sm font-medium text-heading">{children}</label>;
}

export function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-ink-950 text-heading">
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
    gold: "border-gold-700 bg-brand-softer text-gold-300",
    neutral: "border-ink-600 bg-ink-800 text-heading",
    danger: "border-red-700/50 bg-red-500/10 text-red-400",
  };
  return (
    <span
      className={`inline-flex items-center rounded-[2px] border-2 px-2 py-1 text-xs font-medium uppercase tracking-[0.4px] ${tones[tone]}`}
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
