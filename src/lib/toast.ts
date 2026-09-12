import { toast } from "sonner";

/**
 * Ids of ERROR toasts currently on screen — the only kind that persists indefinitely (see
 * components/ui/sonner.tsx's Toaster `duration`) — so a closing dialog can sweep away whichever of
 * them are still open instead of leaving them stranded once the context that explained them is
 * gone. Success/info/warning toasts are deliberately NOT tracked here: they already auto-dismiss
 * on their own after a few seconds, and are very often created in the same instant a dialog closes
 * (to confirm the action that just closed it) — sweeping those away too would eat the very
 * confirmation the user is about to see.
 *
 * Patches toast.error once, here, rather than requiring every one of its many call sites across
 * the app to opt in — they all already `import { toast } from "sonner"`, and toast is a plain
 * mutable object (`Object.assign(basicToast, {...})` in sonner's own source), so this single
 * import (see components/ui/dialog.tsx) is enough to apply everywhere.
 */
const openErrorToastIds = new Set<string | number>();

const originalError = toast.error;
toast.error = ((message: Parameters<typeof toast.error>[0], opts?: Parameters<typeof toast.error>[1]) => {
  const id = originalError(message, {
    duration: Infinity,
    ...opts,
    onDismiss: (t) => {
      openErrorToastIds.delete(t.id);
      opts?.onDismiss?.(t);
    },
    onAutoClose: (t) => {
      openErrorToastIds.delete(t.id);
      opts?.onAutoClose?.(t);
    },
  });
  openErrorToastIds.add(id);
  return id;
}) as typeof toast.error;

/** Dismisses every currently-open error toast — call when the dialog/flow that produced them
 * closes, so a validation/extraction error left over from an abandoned attempt doesn't linger
 * forever with nothing on screen left to explain it. */
export function dismissOpenErrorToasts() {
  for (const id of openErrorToastIds) toast.dismiss(id);
  openErrorToastIds.clear();
}
