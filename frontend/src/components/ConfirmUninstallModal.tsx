import { Button, Card, Modal } from "./ui";

/** Confirmation before uninstalling a Sydekyk — uninstall deletes the HQ's config for it. */
export function ConfirmUninstallModal({
  sydekykName,
  open,
  pending,
  onConfirm,
  onClose,
}: {
  sydekykName: string;
  open: boolean;
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose}>
      <Card className="p-7">
        <h2 className="text-xl font-bold text-heading">Remove {sydekykName}?</h2>
        <p className="mt-3 text-sm leading-6 text-body">
          This deletes {sydekykName}'s configuration for your HQ — its AI engine, connections, and
          Hero access grants — and stops any of its scheduled activity. Its work so far (findings,
          drafts, signed documents, and mission history) is kept.
        </p>
        <p className="mt-3 text-sm leading-6 text-body">
          If you add {sydekykName} back later, you'll need to set it up again from scratch.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="ghost"
            onClick={onConfirm}
            disabled={pending}
            className="border-red-500/50 text-red-400 hover:border-red-500 hover:text-red-300"
          >
            {pending ? "Removing…" : `Remove ${sydekykName}`}
          </Button>
        </div>
      </Card>
    </Modal>
  );
}
