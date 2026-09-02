import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useStore } from "@/lib/store";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ArrowLeft, Pencil, Trash2, Eye, Plus, Receipt, FileWarning, FolderOpen, FileSignature } from "lucide-react";
import { fmtCurrency, daysUntil } from "@/lib/calculations";
import { openBillDocument } from "@/lib/files";
import { ProviderDialog, ProviderRow, ProviderAgreementDialog } from "@/components/PropertyShared";
import { agreementsForProvider } from "@/lib/providerAgreements";
import { hasFeeTerms } from "@/lib/feeVerification";
import { toast } from "sonner";
import type { ProviderAgreement, ProviderDocument } from "@/lib/types";

export const Route = createFileRoute("/providers_/$providerId")({
  head: () => ({
    meta: [{ title: "Provider — Landlord OS" }],
  }),
  component: ProviderProfilePage,
});

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Couldn't read file"));
    reader.readAsDataURL(file);
  });
}

function ProviderDocumentDialog({ providerId, doc, trigger }: { providerId: string; doc?: ProviderDocument; trigger?: React.ReactNode }) {
  const { addProviderDocument, updateProviderDocument } = useStore();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    docType: doc?.docType ?? "",
    expiryDate: doc?.expiryDate ?? "",
    fileName: doc?.fileName ?? "",
    fileData: doc?.fileData ?? "",
  });

  const handleFile = async (f: File | undefined) => {
    if (!f) return;
    const data = await readFileAsDataUrl(f);
    setForm((s) => ({ ...s, fileName: f.name, fileData: data }));
  };

  const save = () => {
    if (!form.docType.trim()) return toast.error("Document type is required");
    const payload = {
      providerId,
      docType: form.docType.trim(),
      expiryDate: form.expiryDate || undefined,
      fileName: form.fileName || undefined,
      fileData: form.fileData || undefined,
    };
    if (doc) {
      updateProviderDocument(doc.id, payload);
      toast.success("Document updated");
    } else {
      addProviderDocument(payload);
      toast.success("Document added");
    }
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs">
            <Plus className="h-3 w-3" /> Add document
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{doc ? "Edit document" : "Add document"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Upload file</Label>
            <Input type="file" accept="application/pdf,image/*" onChange={(e) => void handleFile(e.target.files?.[0])} />
            {form.fileName && (
              <div className="mt-1 flex items-center justify-between gap-2 rounded bg-muted/50 px-2 py-1 text-xs">
                <span className="truncate">{form.fileName}</span>
                <Button size="sm" variant="ghost" className="h-6 shrink-0 gap-1 text-xs" onClick={() => openBillDocument(form.fileName, form.fileData)}>
                  <Eye className="h-3 w-3" /> View
                </Button>
              </div>
            )}
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Document type</Label>
            <Input
              value={form.docType}
              onChange={(e) => setForm((f) => ({ ...f, docType: e.target.value }))}
              placeholder="e.g. Certificate of Currency, Trade Licence"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Expiry date</Label>
            <Input type="date" value={form.expiryDate} onChange={(e) => setForm((f) => ({ ...f, expiryDate: e.target.value }))} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={save}>Save document</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProviderDocumentRow({ doc }: { doc: ProviderDocument }) {
  const { deleteProviderDocument } = useStore();
  const expiring = doc.expiryDate ? daysUntil(doc.expiryDate) : undefined;
  return (
    <div className="flex items-start justify-between gap-2 rounded border p-2 text-xs">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{doc.docType || "Document"}</span>
          {expiring !== undefined && expiring <= 30 && (
            <Badge variant={expiring < 0 ? "destructive" : "outline"} className="text-[10px]">
              {expiring < 0 ? "Expired" : `Expires in ${expiring}d`}
            </Badge>
          )}
        </div>
        {doc.expiryDate && <div className="mt-0.5 text-muted-foreground">Expires {doc.expiryDate}</div>}
        {doc.fileData && (
          <button
            type="button"
            onClick={() => openBillDocument(doc.fileName, doc.fileData)}
            className="mt-1 inline-flex items-center gap-1 text-primary underline"
          >
            <Eye className="h-3 w-3" /> View
          </button>
        )}
      </div>
      <div className="flex shrink-0 gap-1">
        <ProviderDocumentDialog
          providerId={doc.providerId}
          doc={doc}
          trigger={
            <Button size="icon" variant="ghost" className="h-6 w-6">
              <Pencil className="h-3 w-3" />
            </Button>
          }
        />
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          onClick={() => {
            if (confirm(`Delete "${doc.docType || "this document"}"?`)) {
              deleteProviderDocument(doc.id);
              toast.success("Document removed");
            }
          }}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

function AgreementRow({ agreement }: { agreement: ProviderAgreement }) {
  const { state, deleteProviderAgreement } = useStore();
  const property = state.properties.find((p) => p.id === agreement.propertyId);
  return (
    <div className="flex items-start justify-between gap-2 rounded border p-2 text-xs">
      <div className="min-w-0">
        <div className="font-medium">{property?.alias || property?.address || "Unknown property"}</div>
        {agreement.contractStartDate && (
          <div className="text-muted-foreground">
            From {agreement.contractStartDate}
            {agreement.contractReviewDate ? ` · reviews ${agreement.contractReviewDate}` : ""}
          </div>
        )}
        {hasFeeTerms(agreement) && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-muted-foreground">
            {agreement.managementFeePercent !== undefined && <span>Mgmt fee {agreement.managementFeePercent}%</span>}
            {agreement.lettingFeeAmount !== undefined && <span>Letting {fmtCurrency(agreement.lettingFeeAmount)}</span>}
            {agreement.lettingFeeWeeksRent !== undefined && <span>Letting {agreement.lettingFeeWeeksRent} wk rent</span>}
            {agreement.adminFeeAmount !== undefined && <span>Admin {fmtCurrency(agreement.adminFeeAmount)}</span>}
            {agreement.leaseRenewalFeeAmount !== undefined && <span>Renewal {fmtCurrency(agreement.leaseRenewalFeeAmount)}</span>}
            {agreement.inspectionFeeAmount !== undefined && <span>Inspection {fmtCurrency(agreement.inspectionFeeAmount)}</span>}
            {agreement.advertisingFeeAmount !== undefined && <span>Advertising {fmtCurrency(agreement.advertisingFeeAmount)}</span>}
            {agreement.gstApplicable && <span>+GST</span>}
          </div>
        )}
        {agreement.contractFileData && (
          <button
            type="button"
            onClick={() => openBillDocument(agreement.contractFileName, agreement.contractFileData)}
            className="mt-1 inline-flex items-center gap-1 text-primary underline"
          >
            <Eye className="h-3 w-3" /> View agreement
          </button>
        )}
      </div>
      <div className="flex shrink-0 gap-1">
        <ProviderAgreementDialog providerId={agreement.providerId} agreement={agreement}>
          <Button size="icon" variant="ghost" className="h-6 w-6">
            <Pencil className="h-3 w-3" />
          </Button>
        </ProviderAgreementDialog>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          onClick={() => {
            if (confirm(`Delete this agreement for ${property?.alias || property?.address || "this property"}?`)) {
              deleteProviderAgreement(agreement.id);
              toast.success("Agreement deleted");
            }
          }}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

type PaymentRow = {
  id: string;
  date: string;
  description: string;
  amount: number;
  propertyId?: string;
  kind: "Expense" | "Bill";
  status?: string;
};

function ProviderProfilePage() {
  const { providerId } = Route.useParams();
  const { state, deleteProvider } = useStore();
  const navigate = useNavigate();
  const provider = state.providers.find((p) => p.id === providerId);

  if (!provider) {
    return (
      <div className="space-y-4 p-4 sm:p-6">
        <Link to="/providers" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to Providers
        </Link>
        <div className="text-sm text-muted-foreground">This provider no longer exists.</div>
      </div>
    );
  }

  const payments: PaymentRow[] = [
    ...state.expenses
      .filter((e) => e.providerId === provider.id)
      .map((e) => ({ id: e.id, date: e.date, description: e.itemName, amount: e.cost, propertyId: e.propertyId, kind: "Expense" as const })),
    ...state.bills
      .filter((b) => b.providerId === provider.id)
      .map((b) => ({
        id: b.id,
        date: b.paidDate || b.dueDate,
        description: b.billType,
        amount: b.amount,
        propertyId: b.propertyId,
        kind: "Bill" as const,
        status: b.status,
      })),
  ].sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  const outstanding = state.bills.filter((b) => b.providerId === provider.id && b.status !== "Paid");

  const paymentsByProperty = new Map<string, PaymentRow[]>();
  for (const row of payments) {
    const key = row.propertyId ?? "";
    const list = paymentsByProperty.get(key) ?? [];
    list.push(row);
    paymentsByProperty.set(key, list);
  }
  const paymentGroups = Array.from(paymentsByProperty.entries()).map(([propertyId, rows]) => {
    const prop = state.properties.find((p) => p.id === propertyId);
    return { label: prop?.alias || prop?.address || "Unassigned property", rows };
  });
  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);

  const documents = state.providerDocuments.filter((d) => d.providerId === provider.id);
  const agreements = agreementsForProvider(state.providerAgreements, provider.id);

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <Link to="/providers" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Providers
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{provider.name}</h1>
            <Badge variant="secondary">{provider.role}</Badge>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 text-sm text-muted-foreground">
            {provider.phone && <span>{provider.phone}</span>}
            {provider.email && <span>{provider.email}</span>}
            {provider.abn && <span>ABN {provider.abn}</span>}
            {provider.defaultCategory && <span>Default category: {provider.defaultCategory}</span>}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <ProviderDialog provider={provider}>
            <Button size="sm" variant="outline" className="gap-1">
              <Pencil className="h-4 w-4" /> Edit
            </Button>
          </ProviderDialog>
          <Button
            size="sm"
            variant="outline"
            className="gap-1 text-destructive hover:text-destructive"
            onClick={() => {
              if (confirm(`Delete "${provider.name}"? This cannot be undone.`)) {
                deleteProvider(provider.id);
                toast.success("Provider removed");
                void navigate({ to: "/providers" });
              }
            }}
          >
            <Trash2 className="h-4 w-4" /> Delete
          </Button>
        </div>
      </div>

      <div className="rounded-md border p-3">
        <ProviderRow provider={provider} />
      </div>

      <Card>
        <CardContent className="space-y-2 p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <FileSignature className="h-4 w-4" /> Agreements
            </div>
            <ProviderAgreementDialog providerId={provider.id}>
              <Button size="sm" variant="outline" className="h-7 gap-1 text-xs">
                <Plus className="h-3 w-3" /> Add agreement
              </Button>
            </ProviderAgreementDialog>
          </div>
          {agreements.length === 0 && (
            <div className="text-xs text-muted-foreground">
              No management agreement on file for this provider at any property yet.
            </div>
          )}
          <div className="space-y-2">
            {agreements.map((a) => (
              <AgreementRow key={a.id} agreement={a} />
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Receipt className="h-4 w-4" /> Payment history
            <span className="ml-auto text-xs font-normal text-muted-foreground">Total {fmtCurrency(totalPaid)}</span>
          </div>
          {payments.length === 0 && <div className="text-xs text-muted-foreground">No payments recorded against this provider yet.</div>}
          {paymentGroups.map((g) => (
            <PaymentGroup key={g.label} label={g.label} rows={g.rows} />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <FileWarning className="h-4 w-4" /> Outstanding invoices
          </div>
          {outstanding.length === 0 && <div className="text-xs text-muted-foreground">Nothing outstanding.</div>}
          <div className="space-y-1.5">
            {outstanding.map((b) => {
              const prop = state.properties.find((p) => p.id === b.propertyId);
              return (
                <div key={b.id} className="flex items-center justify-between gap-2 rounded border p-2 text-xs">
                  <div className="min-w-0">
                    <div className="font-medium">
                      {b.billType} — {fmtCurrency(b.amount)}
                    </div>
                    <div className="text-muted-foreground">
                      {prop?.alias || prop?.address || "Unassigned"} · Due {b.dueDate}
                    </div>
                  </div>
                  <Badge variant={b.status === "Overdue" ? "destructive" : "outline"} className="shrink-0 text-[10px]">
                    {b.status}
                  </Badge>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <FolderOpen className="h-4 w-4" /> Documents
            </div>
            <ProviderDocumentDialog providerId={provider.id} />
          </div>
          {documents.length === 0 && <div className="text-xs text-muted-foreground">No documents on file.</div>}
          <div className="space-y-2">
            {documents.map((d) => (
              <ProviderDocumentRow key={d.id} doc={d} />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PaymentGroup({ label, rows }: { label: string; rows: PaymentRow[] }) {
  if (rows.length === 0) return null;
  const subtotal = rows.reduce((sum, r) => sum + r.amount, 0);
  return (
    <div className="rounded-md border">
      <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-1.5 text-xs font-medium">
        <span>{label}</span>
        <span>{fmtCurrency(subtotal)}</span>
      </div>
      <div className="divide-y">
        {rows.map((r) => (
          <div key={`${r.kind}_${r.id}`} className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs">
            <div className="min-w-0">
              <span className="font-medium">{r.description}</span>
              <span className="ml-2 text-muted-foreground">{r.date}</span>
              <Badge variant="secondary" className="ml-2 text-[10px]">
                {r.kind}
              </Badge>
              {r.status && (
                <Badge variant="outline" className="ml-1 text-[10px]">
                  {r.status}
                </Badge>
              )}
            </div>
            <span className="shrink-0 font-medium">{fmtCurrency(r.amount)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
