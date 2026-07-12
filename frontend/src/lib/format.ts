/** Human-friendly amount of manual work, from minutes: "45 min", "~6.5 h", "~3 days" (8h workday).
 * Used on the dashboard to express how much hands-on time an agent has taken off the team. */
export function formatWorkTime(minutes: number): string {
  if (!minutes || minutes < 1) return "0 min";
  const hours = minutes / 60;
  if (hours < 1) return `${Math.round(minutes)} min`;
  if (hours < 80) return `~${hours < 10 ? hours.toFixed(1) : Math.round(hours)} h`;
  return `~${Math.round(hours / 8)} days`;
}

/** Format an amount as money. Uses the bill's ISO currency when known (e.g. "$34.50", "€1,200.00");
 * falls back to a plain "$" with 2 decimals. */
export function formatMoney(amount: number, currency?: string | null): string {
  if (currency && /^[A-Za-z]{3}$/.test(currency)) {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: currency.toUpperCase() }).format(amount);
    } catch {
      /* fall through */
    }
  }
  return `$${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Money without decimals, in the given ISO currency ("$4", "₱1,200", "€980"); falls back to "$".
 * Used for the labor-cost savings figures, which have no intrinsic currency (they come from a wage),
 * so they render in the tenant's chosen reporting currency. */
export function formatMoneyCompact(amount: number, currency?: string | null): string {
  if (currency && /^[A-Za-z]{3}$/.test(currency)) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currency.toUpperCase(),
        maximumFractionDigits: 0,
      }).format(amount);
    } catch {
      /* fall through */
    }
  }
  return `$${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

/** Human-friendly actual AI run time, from seconds: "under 1s", "12s", "3 min", "1.4 h". Used to
 * show how FAST the agent actually was (contrast against the manual-hours equivalent). */
export function formatFastTime(seconds: number): string {
  if (!seconds || seconds < 1) return "under 1s";
  if (seconds < 90) return `${Math.round(seconds)}s`;
  const mins = seconds / 60;
  if (mins < 90) return `${Math.round(mins)} min`;
  return `${(mins / 60).toFixed(1)} h`;
}
