import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useStore } from "@/lib/store";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileText, Mail, FolderOpen } from "lucide-react";
import { fmtCurrency } from "@/lib/calculations";
import type { AiIntakeProposal } from "@/lib/types";

export const Route = createFileRoute("/documents")({
  head: () => ({
    meta: [
      { title: "Documents — Landlord OS" },
      { name: "description", content: "Reusable reference records — leases, insurance, compliance certs, loan documents, depreciation reports and more — kept for reference." },
    ],
  }),
  component: DocumentsPage,
});

interface DocumentEntry {
  id: string;
  kind:
    | "Maintenance"
    | "Condition Report"
    | "Lease Agreement"
    | "Rent Statement"
    | "Property Document"
    | "Depreciation Report"
    | "Unrecognised"
    | "Loan Document"
    | "Loan Statement"
    | "Bank Statement"
    | "Property Sale";
  date: string;
  propertyId?: string;
  label: string;
  amount?: number;
  status?: string;
  fileName?: string;
  fileData?: string;
  subject?: string;
  emailBody?: string;
}

function proposalDocumentKind(kind: AiIntakeProposal["kind"]): DocumentEntry["kind"] {
  switch (kind) {
    case "tenant_lease":
      return "Lease Agreement";
    case "property_detail":
      return "Property Document";
    case "depreciation_report":
      return "Depreciation Report";
    case "unclassified":
      return "Unrecognised";
    case "loan_document":
      return "Loan Document";
    case "loan_statement":
      return "Loan Statement";
    case "bank_statement":
      return "Bank Statement";
    case "property_sale":
      return "Property Sale";
    default:
      return "Rent Statement";
  }
}

function proposalDocumentLabel(p: AiIntakeProposal): string {
  switch (p.kind) {
    case "bill":
      return p.providerName || "Bill";
    case "expense":
      return (p.payload as { itemName?: string }).itemName ?? "Transaction";
    case "tenant_lease":
      return (p.payload as { name?: string }).name ?? "Lease agreement";
    case "property_detail":
      return (p.payload as { documentCategory?: string }).documentCategory ?? "Property document";
    case "depreciation_report":
      return (p.payload as { quantitySurveyor?: string }).quantitySurveyor ?? "Depreciation report";
    case "unclassified":
      return (p.payload as { documentCategory?: string }).documentCategory ?? "Unrecognised document";
    case "loan_document":
    case "loan_statement":
      return (p.payload as { lenderName?: string }).lenderName ?? "Loan";
    case "bank_statement":
      return (p.payload as { bankName?: string }).bankName ?? "Bank statement";
    case "property_sale":
      return "Property sale";
    default:
      return (p.payload as { tenantName?: string }).tenantName ?? "Rent statement";
  }
}

function DocumentsPage() {
  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
        <p className="text-sm text-muted-foreground">
          Reusable reference records — leases, condition reports, insurance and compliance certificates,
          depreciation reports, loan documents, maintenance invoices/warranties and monthly agent
          statements — kept here for reference. Routine bills and one-off transactions live in
          Bills and Transactions instead.
        </p>
      </div>
      <DocumentsContent />
    </div>
  );
}

/** Extracted so the Assets left-nav can embed the same content without the page-level heading. */
export function DocumentsContent() {
  const { state } = useStore();
  const [propertyId, setPropertyId] = useState("__all__");
  const [kind, setKind] = useState<"__all__" | DocumentEntry["kind"]>("__all__");
  const [query, setQuery] = useState("");

  const entries: DocumentEntry[] = [
    // Only expenses that are themselves reusable reference material — a maintenance job's
    // invoice, or anything carrying a warranty — not every routine one-off transaction.
    ...state.expenses
      .filter((e) => (e.invoiceFileData || e.sourceEmailBody) && (e.category === "Repairs & Maintenance" || e.hasWarranty || e.warrantyExpiry))
      .map((e) => ({
        id: e.id,
        kind: "Maintenance" as const,
        date: e.date,
        propertyId: e.propertyId,
        label: e.itemName,
        amount: e.cost,
        status: e.status,
        fileName: e.invoiceFileName,
        fileData: e.invoiceFileData,
        subject: e.sourceSubject,
        emailBody: e.sourceEmailBody,
      })),
    // Inspection reports/condition reports — currently the only place these get attached.
    ...state.inspections
      .filter((i) => i.fileData)
      .map((i) => ({
        id: i.id,
        kind: "Condition Report" as const,
        date: i.date,
        propertyId: i.propertyId,
        label: `${i.type} inspection`,
        fileName: i.fileFileName,
        fileData: i.fileData,
      })),
    ...state.aiProposals
      .filter((p) => p.kind !== "bill" && p.kind !== "expense")
      .map((p) => {
        const kind = proposalDocumentKind(p.kind);
        const label = proposalDocumentLabel(p);
        return {
          id: p.id,
          kind,
          date: p.created_at?.slice(0, 10) ?? "",
          propertyId: p.propertyId,
          label,
          status: p.status,
          fileName: p.sourceFileName,
          fileData: p.sourceFileData,
          subject: p.sourceSubject,
          emailBody: p.sourceEmailBody,
        };
      }),
  ].sort((a, b) => (a.date < b.date ? 1 : -1));

  const filtered = entries.filter((d) => {
    if (propertyId !== "__all__" && d.propertyId !== propertyId) return false;
    if (kind !== "__all__" && d.kind !== kind) return false;
    if (query && !`${d.label} ${d.subject ?? ""}`.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-[220px]"
        />
        <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All types</SelectItem>
            <SelectItem value="Lease Agreement">Lease agreements</SelectItem>
            <SelectItem value="Rent Statement">Rent statements</SelectItem>
            <SelectItem value="Property Document">Property documents</SelectItem>
            <SelectItem value="Depreciation Report">Depreciation reports</SelectItem>
            <SelectItem value="Loan Document">Loan documents</SelectItem>
            <SelectItem value="Loan Statement">Loan statements</SelectItem>
            <SelectItem value="Bank Statement">Bank statements</SelectItem>
            <SelectItem value="Property Sale">Property sales</SelectItem>
            <SelectItem value="Maintenance">Maintenance</SelectItem>
            <SelectItem value="Condition Report">Condition reports</SelectItem>
            <SelectItem value="Unrecognised">Unrecognised</SelectItem>
          </SelectContent>
        </Select>
        <Select value={propertyId} onValueChange={setPropertyId}>
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="All properties" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All properties</SelectItem>
            {state.properties.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.alias || p.address}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        {filtered.length === 0 && (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              <FolderOpen className="mx-auto mb-2 h-6 w-6" />
              No documents match these filters.
            </CardContent>
          </Card>
        )}
        {filtered.map((d) => {
          const property = state.properties.find((p) => p.id === d.propertyId);
          return (
            <Card key={`${d.kind}-${d.id}`}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{d.kind}</Badge>
                    <span className="font-medium">{d.label}</span>
                    {d.amount !== undefined && <span className="text-muted-foreground">{fmtCurrency(d.amount)}</span>}
                    {d.status && <Badge variant="secondary">{d.status}</Badge>}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {d.date || "—"} {property && `• ${property.alias || property.address}`}
                  </div>
                </div>
                <DocumentLinks fileName={d.fileName} fileData={d.fileData} subject={d.subject} emailBody={d.emailBody} />
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function DocumentLinks({
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
  if (!fileData && !emailBody) return <span className="text-xs text-muted-foreground">No document attached</span>;
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      {fileData && (
        <a href={fileData} download={fileName || "document.pdf"} className="inline-flex items-center gap-1 text-primary underline">
          <FileText className="h-3 w-3" /> View file
        </a>
      )}
      {emailBody && (
        <>
          <button type="button" onClick={() => setShowEmail(true)} className="inline-flex items-center gap-1 text-primary underline">
            <Mail className="h-3 w-3" /> View email
          </button>
          <Dialog open={showEmail} onOpenChange={setShowEmail}>
            <DialogContent className="max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{subject || "Email"}</DialogTitle>
              </DialogHeader>
              <pre className="whitespace-pre-wrap text-xs">{emailBody}</pre>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}
