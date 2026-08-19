import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, ExternalLink, Paperclip, Receipt, Trash2 } from "lucide-react";
import { fmtCurrency, todayISO } from "@/lib/calculations";
import type { PropertyBill } from "@/lib/types";
import { BillDetailDialog } from "@/components/BillDetailDialog";

const IMAGE_EXT_MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

function openSourceDocument(bill: PropertyBill) {
  if (!bill.sourceFileData) return;
  const ext = (bill.sourceFileName ?? "").toLowerCase().split(".").pop() ?? "";
  const mime = IMAGE_EXT_MIME[ext] ?? "application/pdf";
  window.open(`data:${mime};base64,${bill.sourceFileData}`, "_blank");
}

export function BillRow({
  bill,
  onPaid,
  onDelete,
  propertyLabel,
}: {
  bill: PropertyBill;
  onPaid: () => void;
  onDelete: () => void;
  /** When set (e.g. on a portfolio-wide list), shown alongside the due date so bills aren't ambiguous. */
  propertyLabel?: string;
}) {
  const overdue = bill.status === "Unpaid" && bill.dueDate < todayISO();
  return (
    <div className="rounded-md border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <BillDetailDialog
          bill={bill}
          propertyLabel={propertyLabel}
          trigger={
            <div className="min-w-0 flex-1 cursor-pointer">
              <div className="flex flex-wrap items-center gap-2">
                <Receipt className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{bill.billType}</span>
                <Badge variant={bill.status === "Paid" ? "secondary" : overdue ? "destructive" : "outline"}>
                  {overdue ? "Overdue" : bill.status}
                </Badge>
                {bill.recurrenceMonths ? <Badge variant="outline">Every {bill.recurrenceMonths}mo</Badge> : null}
                {bill.label ? <Badge variant="secondary">{bill.label}</Badge> : null}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Due {bill.dueDate} • {fmtCurrency(bill.amount)}
                {propertyLabel && <> • {propertyLabel}</>}
                {bill.providerName && <> • {bill.providerName}</>}
                {bill.source && <> • {bill.source}</>}
              </div>
              {bill.notes && <div className="mt-1 text-xs">{bill.notes}</div>}
            </div>
          }
        />
        <div className="flex gap-1">
          {bill.status !== "Paid" && (
            <Button size="sm" variant="outline" className="gap-1" onClick={onPaid}>
              <CheckCircle2 className="h-3 w-3" /> Mark Paid
            </Button>
          )}
          <Button size="icon" variant="ghost" onClick={onDelete}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {bill.sourceFileData && (
        <button
          type="button"
          onClick={() => openSourceDocument(bill)}
          className="mt-1 inline-flex items-center gap-1 text-xs text-primary"
        >
          <Paperclip className="h-3 w-3" /> {bill.sourceFileName || "Source document"}
        </button>
      )}
      {bill.portalUrl && (
        <a href={bill.portalUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-primary">
          Open portal <ExternalLink className="h-3 w-3" />
        </a>
      )}
      {(bill.portalUsername || bill.passwordNote) && (
        <div className="mt-1 text-xs text-muted-foreground">
          {bill.portalUsername && <>User: <span className="font-mono">{bill.portalUsername}</span></>}
          {bill.passwordNote && <> • Note: <span className="font-mono">{bill.passwordNote}</span></>}
        </div>
      )}
    </div>
  );
}
