/** Human-friendly amount of manual work, from minutes: "45 min", "~6.5 h", "~3 days" (8h workday).
 * Used on the dashboard to express how much hands-on time an agent has taken off the team. */
export function formatWorkTime(minutes: number): string {
  if (!minutes || minutes < 1) return "0 min";
  const hours = minutes / 60;
  if (hours < 1) return `${Math.round(minutes)} min`;
  if (hours < 80) return `~${hours < 10 ? hours.toFixed(1) : Math.round(hours)} h`;
  return `~${Math.round(hours / 8)} days`;
}
