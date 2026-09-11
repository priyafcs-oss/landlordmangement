import { useState } from "react";
import { useStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { BillDocumentViewer } from "@/components/BillDocumentViewer";
import { toast } from "sonner";

/** Edits a rent-payment (or other income) ledger row's date/amount/description — from the
 * Transactions table, the property's own Owner Ledger tab, or anywhere else a ledger row is
 * listed. Updating recomputes the tenant's paid-up-to date the same way a delete already did (see
 * updateLedger in store.tsx). Shows the same source-document pane as editing an expense — a rent
 * line posted via an agent statement has one (LedgerEntry.sourceFileName), so this income-side
 * edit isn't a stripped-down experience next to the expense one. */
export function EditLedgerRowDialog({ ledgerEntryId, trigger }: { ledgerEntryId: string; trigger: React.ReactNode }) {
  const { state, updateLedger } = useStore();
  const entry = state.ledger.find((e) => e.id === ledgerEntryId);
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(entry?.date ?? "");
  const [amount, setAmount] = useState(entry ? String(entry.credit) : "");
  const [description, setDescription] = useState(entry?.description ?? "");
  const [sourceDoc, setSourceDoc] = useState<{ fileName?: string; fileData?: string } | null>(null);
  const [sourceDocRemoved, setSourceDocRemoved] = useState(false);
  const [docExpanded, setDocExpanded] = useState(false);

  const onOpenChange = (o: boolean) => {
    setOpen(o);
    if (o && entry) {
      setDate(entry.date);
      setAmount(String(entry.credit));
      setDescription(entry.description);
      setSourceDoc(entry.sourceFileName ? { fileName: entry.sourceFileName, fileData: entry.sourceFileData ?? undefined } : null);
      setSourceDocRemoved(false);
    }
    if (!o) setDocExpanded(false);
  };

  const save = () => {
    const val = parseFloat(amount);
    if (!val || val <= 0) return toast.error("Enter a valid amount");
    if (!date) return toast.error("Date is required");
    updateLedger(ledgerEntryId, {
      date,
      credit: val,
      description,
      ...(sourceDocRemoved ? { sourceFileName: null, sourceFileData: null } : {}),
    });
    toast.success(entry?.type === "Rent Payment" ? "Rent payment updated" : "Transaction updated");
    setOpen(false);
  };

  if (!entry) return null;
  // A ledger row isn't always literally rent — Water Invoice/Maintenance Charge/Manual Credit/
  // Adjustment/Rent Due all show under the "Other Rental Income" category too (see
  // ledgerTypeToIncomeCategory) but aren't rent payments, so the title shouldn't call them one.
  const isRent = entry.type === "Rent Payment";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        className={
          docExpanded
            ? "flex h-[95vh] max-h-[95vh] w-[95vw] max-w-[95vw] flex-col overflow-y-auto"
            : "max-w-2xl"
        }
      >
        <DialogHeader>
          <DialogTitle>{isRent ? "Edit rent payment" : `Edit ${entry.type.toLowerCase()}`}</DialogTitle>
        </DialogHeader>
        <div className={"grid gap-4 text-sm " + (docExpanded ? "flex-1 overflow-hidden sm:grid-cols-[minmax(0,1fr)_320px]" : "sm:grid-cols-[240px_1fr]")}>
          <div className={docExpanded ? "overflow-y-auto pr-1" : ""}>
            <BillDocumentViewer
              fileName={sourceDoc?.fileName}
              fileData={sourceDoc?.fileData}
              expanded={docExpanded}
              onToggleExpand={() => setDocExpanded((v) => !v)}
              onRemove={
                sourceDoc
                  ? () => {
                      setSourceDoc(null);
                      setSourceDocRemoved(true);
                    }
                  : undefined
              }
              emptyLabel="No source statement — this payment was entered directly."
            />
          </div>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Amount</Label>
              <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Description</Label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
