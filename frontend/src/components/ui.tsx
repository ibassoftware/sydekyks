import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

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

export function Card({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={`rounded-xl border border-ink-600 bg-gradient-to-b from-ink-800 to-ink-900 shadow-xl ${className}`}
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
