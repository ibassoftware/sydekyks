/** Renders a Signet mission's outcome - invitations sent or reminders chased for an envelope. Reads
 * from `result_summary`. */
export function SignetMissionSummary({ summary }: { summary: Record<string, unknown> }) {
  const title = (summary.title as string) || "the document";
  const action = summary.action as string | undefined;
  const sent = (summary.sent as number) ?? 0;

  const verb = action === "reminded" ? "Reminded" : "Sent";
  const noun = action === "reminded" ? "reminder" : "invitation";

  return (
    <div className="text-sm text-[#d8cdb9]">
      <p>
        <span className="text-gold-300">{verb}</span> {sent} {noun}{sent === 1 ? "" : "s"} for “{title}”
      </p>
    </div>
  );
}
