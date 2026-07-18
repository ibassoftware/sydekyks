import type { ReactNode } from "react";

export function SettingsBand({
  id,
  title,
  description,
  children,
}: {
  id?: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-8">
      <div>
        <h2 className="settings-band-title">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-body">{description}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export function SettingsColumns({ children }: { children: ReactNode }) {
  return <div className="grid gap-5 sm:grid-cols-2">{children}</div>;
}

export function SettingsToggle({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-20 items-center justify-between gap-5 border-b-2 border-ink-600 py-4 text-heading last:border-b-0">
      <span>
        <span className="block text-sm font-semibold">{label}</span>
        <span className="mt-1 block text-xs leading-5 text-body">{description}</span>
      </span>
      <input
        type="checkbox"
        className="h-5 w-5 shrink-0 accent-gold-500"
        disabled={disabled}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}
