import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { fmtCurrency } from "@/lib/calculations";
import { openBillDocument } from "@/lib/files";
import type { DuplicateMatch } from "@/lib/billMatch";

/**
 * Shared between AddBillDialog and AddTransactionDialog — the two entry points with no
 * server-side guardrail of any kind. Stops the save, shows what already exists, and always
 * leaves the final call to the landlord (Cancel vs. Save Anyway) rather than blocking outright.
 */
export function DuplicateWarningDialog({
  match,
  onCancel,
  onSaveAnyway,
}: {
  match: DuplicateMatch | null;
  onCancel: () => void;
  onSaveAnyway: () => void;
}) {
  return (
    <Dialog open={!!match} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Possible duplicate</DialogTitle>
        </DialogHeader>
        {match && (
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">This looks like it might already be recorded:</p>
            <div className="space-y-1 rounded border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{match.kind === "bill" ? "Bill" : "Transaction"}</Badge>
                <span className="font-medium">{match.label}</span>
                {match.status && <Badge variant="outline">{match.status}</Badge>}
              </div>
              <div className="text-muted-foreground">
                {fmtCurrency(match.amount)} • {match.date}
              </div>
              {match.sourceFileData && (
                <Button
                  size="sm"
                  variant="link"
                  className="h-auto px-0 text-primary"
                  onClick={() => openBillDocument(match.sourceFileName, match.sourceFileData)}
                >
                  View existing bill PDF
                </Button>
              )}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onSaveAnyway}>
            Save duplicate anyway
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
