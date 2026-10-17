import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { fmtCurrency } from "@/lib/calculations";
import { openBillDocument } from "@/lib/files";
import { findDuplicateRecord, type DuplicateCandidate, type DuplicateMatch } from "@/lib/billMatch";
import { useState } from "react";
import { toast } from "sonner";
import { useStore } from "@/lib/store";

/**
 * Shared between AddBillDialog and AddTransactionDialog — the two entry points with no
 * server-side guardrail of any kind. Stops the save, shows what already exists, and always
 * leaves the final call to the landlord (Cancel vs. Save Anyway) rather than blocking outright.
 */
export function DuplicateWarningDialog({
  match,
  onCancel,
  onSaveAnyway,
  onAttachInstead,
}: {
  match: DuplicateMatch | null;
  onCancel: () => void;
  onSaveAnyway: () => void;
  /** Offered instead of a hard "Cancel vs Save Anyway" choice when the file being saved might just
   * be the actual invoice/document EVIDENCE for the match already on file (e.g. a rent-statement
   * deduction with no PDF yet) rather than a genuinely separate second charge — attaches the
   * current file onto the existing record instead of creating a duplicate. Omit when there's no
   * file to attach, or the match is a Bill rather than an Expense (a Bill's own file is handled
   * differently, via the bill itself). */
  onAttachInstead?: () => void;
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
                <Badge variant="secondary">
                  {match.kind === "bill"
                    ? "Bill"
                    : match.kind === "rent"
                      ? "Rent payment"
                      : "Transaction"}
                </Badge>
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
                  {match.kind === "bill" ? "View existing bill PDF" : "View source document"}
                </Button>
              )}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          {onAttachInstead && (
            <Button variant="secondary" onClick={onAttachInstead}>
              Attach to this transaction instead
            </Button>
          )}
          <Button variant="destructive" onClick={onSaveAnyway}>
            Save duplicate anyway
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The pre-save duplicate check for bills and transactions, with its warning dialog and the
 * "attach this file to the existing transaction instead" option. Call `guard(candidate)` before
 * saving — true means a likely duplicate was found and the warning is showing (don't save yet);
 * the warning's "Save anyway" then calls `onSaveAnyway`. Render `dialog` once in the caller.
 */
export function useDuplicateGuard(opts: {
  onSaveAnyway: () => void;
  /** The document being saved, offered for "attach to the existing transaction" when the match is
   * an Expense with no invoice yet. */
  file?: { fileName?: string; fileData?: string };
  proposalId?: string;
  propertyId?: string;
  /** Called after attaching instead (e.g. to close the dialog). */
  onAttached: () => void;
}) {
  const { state, updateExpense, markProposalApplied } = useStore();
  const [match, setMatch] = useState<DuplicateMatch | null>(null);

  const guard = (candidate: DuplicateCandidate): boolean => {
    const m = findDuplicateRecord(state.bills, state.expenses, candidate);
    setMatch(m);
    return !!m;
  };

  const attachInstead = () => {
    if (match?.kind !== "expense") return;
    updateExpense(match.id, {
      invoiceFileName: opts.file?.fileName || undefined,
      invoiceFileData: opts.file?.fileData || undefined,
    });
    if (opts.proposalId) markProposalApplied(opts.proposalId, { propertyId: opts.propertyId });
    setMatch(null);
    opts.onAttached();
    toast.success("Invoice attached to the existing transaction");
  };

  const dialog = (
    <DuplicateWarningDialog
      match={match}
      onCancel={() => setMatch(null)}
      onSaveAnyway={() => {
        setMatch(null);
        opts.onSaveAnyway();
      }}
      onAttachInstead={match?.kind === "expense" && opts.file?.fileData ? attachInstead : undefined}
    />
  );

  return { guard, dialog };
}
