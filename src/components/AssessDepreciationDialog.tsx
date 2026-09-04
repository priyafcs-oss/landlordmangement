import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/Field";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { fmtCurrency, itemAnnualClaims, taxTreatmentLabel, expenseCategoryToTaxCategory } from "@/lib/calculations";
import { openBillDocument } from "@/lib/files";
import { lookupAtoEffectiveLife, ATO_EFFECTIVE_LIFE_LABELS } from "@/lib/atoEffectiveLife";
import type { DepreciationItem, Expense } from "@/lib/types";

const DIV_40_CATEGORY = "Depreciation - Plant & Equipment (Div 40)" as const;
const DIV_43_CATEGORY = "Capital Works Deduction (Div 43)" as const;

/**
 * "Assess depreciation" — reviews one already-posted Expense and, if the landlord confirms it was
 * actually a capital purchase rather than a running repair, converts it: creates a DepreciationItem
 * (linked back via sourceExpenseId) using the expense's own cost/date, and flips the expense's own
 * taxCategory/category to Capital Works/Depreciation so the same amount is never claimed twice
 * (once as an immediate deduction, again as a depreciation schedule). Mirrors the review-then-commit
 * shape of DuplicateWarningDialog — a controlled dialog driven by `expense` being non-null, not an
 * internal trigger, since it's opened from a button inside another dialog (Edit Transaction).
 */
export function AssessDepreciationDialog({ expense, onClose }: { expense: Expense | null; onClose: () => void }) {
  const { state, addDepreciationItem, updateExpense } = useStore();
  const [confirming, setConfirming] = useState(false);
  const [description, setDescription] = useState("");
  const [effectiveLifeYears, setEffectiveLifeYears] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [method, setMethod] = useState<NonNullable<DepreciationItem["method"]>>("Diminishing Value");
  const [division, setDivision] = useState<NonNullable<DepreciationItem["division"]>>("Div 40");

  // Reset to the review step fresh every time a different expense is opened, rather than carrying
  // over whatever the form looked like the last time this dialog was used.
  useEffect(() => {
    if (!expense) return;
    setConfirming(false);
    setDescription(expense.itemName);
    setEffectiveLifeYears("");
    setPurchaseDate(expense.date);
    setMethod("Diminishing Value");
    setDivision("Div 40");
  }, [expense]);

  if (!expense) return <Dialog open={false} onOpenChange={() => {}} />;

  const property = expense.propertyId ? state.properties.find((p) => p.id === expense.propertyId) : undefined;
  // A Property's own mirrored Asset row is what depreciation items attach to, not the property
  // itself — for a non-property asset (Gold/ETF), the expense's own assetId already is the right one.
  const targetAssetId = property ? property.assetId : expense.assetId;
  const evidenceFileName = expense.invoiceFileName ?? expense.sourceFileName ?? undefined;
  const evidenceFileData = expense.invoiceFileData ?? expense.sourceFileData ?? undefined;

  const atoMatch = lookupAtoEffectiveLife(description);
  const onDescriptionBlur = () => {
    if (effectiveLifeYears) return;
    if (atoMatch) setEffectiveLifeYears(String(atoMatch.years));
  };
  const onDivisionChange = (v: NonNullable<DepreciationItem["division"]>) => {
    setDivision(v);
    // Div 43 (capital works) is only ever claimable straight-line under ATO rules — same lock the
    // main depreciation-item dialog applies.
    if (v === "Div 43") setMethod("Prime Cost");
  };

  const previewLife = parseFloat(effectiveLifeYears) || 1;
  const previewClaims = expense.cost > 0 ? itemAnnualClaims(expense.cost, previewLife, method, purchaseDate || expense.date) : [];

  const createItem = () => {
    if (!targetAssetId) return toast.error("This transaction isn't linked to a property or asset — can't file a depreciation item for it");
    if (!description.trim()) return toast.error("Description required");
    const life = parseFloat(effectiveLifeYears);
    if (!life || life <= 0) return toast.error("Effective life must be greater than 0");

    addDepreciationItem({
      assetId: targetAssetId,
      description: description.trim(),
      purchaseCost: expense.cost,
      effectiveLifeYears: life,
      purchaseDate: purchaseDate || expense.date,
      method,
      division,
      sourceExpenseId: expense.id,
    });
    const newCategory = division === "Div 40" ? DIV_40_CATEGORY : DIV_43_CATEGORY;
    updateExpense(expense.id, {
      taxCategory: expenseCategoryToTaxCategory(newCategory),
      category: newCategory,
    });
    toast.success("Depreciation item created — this transaction is no longer counted as an immediate deduction");
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Assess depreciation</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          This review stays scoped to the selected transaction and its existing evidence. It does not rename or re-file the document.
        </p>

        <div className="grid grid-cols-2 gap-2 rounded border p-3 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">Property</div>
            <div className="font-medium">{property?.alias || property?.address || "—"}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Amount</div>
            <div className="font-medium">{fmtCurrency(expense.cost)}</div>
          </div>
          <div className="col-span-2">
            <div className="text-xs text-muted-foreground">Transaction</div>
            <div className="font-medium">{expense.itemName}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Current treatment</div>
            <div className="font-medium">{taxTreatmentLabel(expense.category)}</div>
          </div>
          {evidenceFileData && (
            <div className="col-span-2">
              <Button size="sm" variant="link" className="h-auto px-0 text-primary" onClick={() => openBillDocument(evidenceFileName, evidenceFileData)}>
                Evidence: {evidenceFileName || "view file"}
              </Button>
            </div>
          )}
        </div>

        {!confirming ? (
          <>
            <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
              <div className="flex items-center gap-1.5 font-medium">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Keep as an immediate expense
              </div>
              <p className="text-xs text-muted-foreground">
                This transaction is currently recorded as a deductible running expense, not a capital purchase. Nothing changes unless you
                confirm the work was a new asset or capital improvement.
              </p>
            </div>
            <DialogFooter className="sm:justify-between">
              <Button variant="outline" onClick={onClose}>
                Keep current treatment
              </Button>
              <Button onClick={() => setConfirming(true)}>This was a new asset or capital improvement</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="space-y-1">
              <div className="text-sm font-medium">Depreciation details</div>
              <div className="text-xs text-muted-foreground">Confirm these fields before anything is created.</div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Field label="Asset or works">
                  <Input
                    list="assess-depreciation-ato-options"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    onBlur={onDescriptionBlur}
                  />
                  <datalist id="assess-depreciation-ato-options">
                    {ATO_EFFECTIVE_LIFE_LABELS.map((label) => (
                      <option key={label} value={label} />
                    ))}
                  </datalist>
                </Field>
                {atoMatch && (
                  <div className="mt-1 flex items-center gap-1 text-xs text-emerald-700">
                    <CheckCircle2 className="h-3 w-3 shrink-0" />
                    Matched ATO reference: {atoMatch.label} — {atoMatch.years} years
                  </div>
                )}
              </div>
              <Field label="Tax division">
                <Select value={division} onValueChange={(v) => onDivisionChange(v as typeof division)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Div 40">Division 40 — plant &amp; equipment</SelectItem>
                    <SelectItem value="Div 43">Division 43 — capital works</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Effective life (years)">
                <Input type="number" value={effectiveLifeYears} onChange={(e) => setEffectiveLifeYears(e.target.value)} placeholder="Auto-fills from item name" />
              </Field>
              <Field label="Method">
                <Select value={method} onValueChange={(v) => setMethod(v as typeof method)} disabled={division === "Div 43"}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Diminishing Value">Diminishing value</SelectItem>
                    <SelectItem value="Prime Cost">Prime cost</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Purchase date">
                <Input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">Uses the transaction's own recorded amount ({fmtCurrency(expense.cost)}) — not editable from this form.</p>
            {previewClaims.length > 0 && (
              <div className="rounded-md border bg-muted/30 p-2 text-xs">
                <span className="font-medium">Estimated deduction — Year 1: {fmtCurrency(previewClaims[0])}</span>
                {previewClaims[1] !== undefined && <span className="text-muted-foreground"> · Year 2 onward: ~{fmtCurrency(previewClaims[1])}/yr</span>}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
              <Button onClick={createItem}>Create depreciation item</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
