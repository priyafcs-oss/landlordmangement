import { useState } from "react";
import { useStore } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Check, Copy, DollarSign, FileText, Mail, Pencil, Trash2, TriangleAlert } from "lucide-react";
import { fmtCurrency, todayISO } from "@/lib/calculations";
import { toast } from "sonner";
import { ExpenseDialog } from "@/components/ExpenseDialog";
import { DocumentLink } from "@/components/DocumentLink";

function DocumentViewLinks({
  fileName,
  fileData,
  subject,
  emailBody,
}: {
  fileName?: string;
  fileData?: string;
  subject?: string;
  emailBody?: string;
}) {
  const [showEmail, setShowEmail] = useState(false);
  if (!fileData && !emailBody) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      {fileData && (
        <DocumentLink fileName={fileName} fileData={fileData} className="inline-flex items-center gap-1 text-primary underline">
          <FileText className="h-3 w-3" /> View PDF
        </DocumentLink>
      )}
      {emailBody && (
        <>
          <button type="button" onClick={() => setShowEmail(true)} className="inline-flex items-center gap-1 text-primary underline">
            <Mail className="h-3 w-3" /> View email
          </button>
          <Dialog open={showEmail} onOpenChange={setShowEmail}>
            <DialogContent className="max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{subject || "Original email"}</DialogTitle>
              </DialogHeader>
              <div className="whitespace-pre-wrap text-sm">{emailBody}</div>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}

/** Anything auto-applied with low confidence, a possible duplicate, or a price spike lands here —
 * shared across Transactions (its main home) rather than scoped to any one intake path, since a
 * flagged item could originate from email, a direct upload, or the Bills pipeline's paired Expense. */
export function NeedsReviewBanner() {
  const { state, updateExpense, deleteExpense } = useStore();
  const flagged = state.expenses.filter((e) => e.status === "needs_review");
  if (flagged.length === 0) return null;

  const copyBpay = async (biller?: string, reference?: string) => {
    if (!biller && !reference) return;
    try {
      await navigator.clipboard.writeText(`Biller code: ${biller ?? "-"}  Ref: ${reference ?? "-"}`);
      toast.success("BPAY details copied");
    } catch {
      toast.error("Couldn't copy — copy manually");
    }
  };

  return (
    <Card className="border-amber-500/50 bg-amber-500/5">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <TriangleAlert className="h-4 w-4 text-amber-600" />
          Needs Review ({flagged.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {flagged.map((e) => {
          const prop = state.properties.find((p) => p.id === e.propertyId);
          return (
            <Card key={e.id} className="border-amber-500/30">
              <CardContent className="flex flex-wrap items-start justify-between gap-3 p-4">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{e.itemName}</span>
                    {(e.source === "email_auto" || e.source === "agent_statement") && <Badge variant="secondary">Auto</Badge>}
                    {(e.reviewReason ?? "")
                      .split("; ")
                      .filter(Boolean)
                      .map((r) => (
                        <Badge key={r} variant="destructive">
                          {r}
                        </Badge>
                      ))}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Due {e.date} • {fmtCurrency(e.cost)}
                  </div>
                  {prop ? (
                    <div className="text-xs text-muted-foreground">{prop.address}</div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-destructive">
                        No property matched{e.rawPropertyAddress ? ` — "${e.rawPropertyAddress}"` : ""}
                      </span>
                      <Select
                        value={e.propertyId ?? ""}
                        onValueChange={(v) => updateExpense(e.id, { propertyId: v })}
                      >
                        <SelectTrigger className="h-7 w-[220px] text-xs">
                          <SelectValue placeholder="Assign property" />
                        </SelectTrigger>
                        <SelectContent>
                          {state.properties.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.address}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {(e.bpayBillerCode || e.bpayReference) && (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-mono">
                        BPAY {e.bpayBillerCode ?? "-"} / {e.bpayReference ?? "-"}
                      </span>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-5 w-5"
                        onClick={() => copyBpay(e.bpayBillerCode, e.bpayReference)}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                  <DocumentViewLinks
                    fileName={e.invoiceFileName ?? undefined}
                    fileData={e.invoiceFileData ?? undefined}
                    subject={e.sourceSubject}
                    emailBody={e.sourceEmailBody}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    onClick={() => {
                      updateExpense(e.id, { status: "approved", reviewReason: null });
                      toast.success("Approved");
                    }}
                  >
                    <Check className="h-3.5 w-3.5" /> Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    onClick={() => {
                      updateExpense(e.id, { status: "paid", paidDate: todayISO(), reviewReason: null });
                      toast.success("Marked as paid");
                    }}
                  >
                    <DollarSign className="h-3.5 w-3.5" /> Mark Paid
                  </Button>
                  <ExpenseDialog
                    expense={e}
                    trigger={
                      <Button size="icon" variant="ghost">
                        <Pencil className="h-4 w-4" />
                      </Button>
                    }
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => {
                      deleteExpense(e.id);
                      toast.success("Discarded");
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </CardContent>
    </Card>
  );
}
