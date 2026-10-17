/**
 * Class names for the "document on the left, fields on the right" dialogs (bill review, saved
 * bill, transaction, loan, ledger row). "Enlarge" on the document grows the whole dialog —
 * document and fields together — to nearly full screen. One definition so every such dialog sizes
 * and scrolls the same way.
 */
export function documentLayout(
  expanded: boolean,
  opts: { dialog?: string; cols?: string; expandedCols?: string } = {},
): { dialog: string; grid: string; left: string; right: string } {
  const {
    dialog = "max-h-[90vh] max-w-5xl overflow-y-auto",
    cols = "md:grid-cols-[340px_1fr]",
    expandedCols = "md:grid-cols-[minmax(0,1fr)_380px]",
  } = opts;
  return {
    dialog: expanded
      ? "flex h-[95vh] max-h-[95vh] w-[95vw] max-w-[95vw] flex-col overflow-y-auto"
      : dialog,
    grid: "grid gap-4 text-sm " + (expanded ? `flex-1 overflow-hidden ${expandedCols}` : cols),
    left: expanded ? "overflow-y-auto pr-1" : "",
    right: expanded ? "overflow-y-auto pl-1" : "",
  };
}
