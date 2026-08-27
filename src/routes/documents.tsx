import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useStore } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileText, FolderOpen } from "lucide-react";
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
    | "Tenant Document"
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

type FileFormat = "PDF" | "Image" | "Spreadsheet" | "Document" | "Email / web" | "Other";
const FILE_FORMATS: FileFormat[] = ["PDF", "Image", "Spreadsheet", "Document", "Email / web", "Other"];

/** File format is inferred from the extension since nothing stores it explicitly — falls back to
 * "Email / web" for an entry that only ever carried the source email (no attachment), and "Other"
 * for an unrecognised extension that still has an actual file attached. */
function fileFormatOf(d: Pick<DocumentEntry, "fileName" | "fileData" | "emailBody">): FileFormat | undefined {
  if (d.fileData) {
    const ext = d.fileName?.split(".").pop()?.toLowerCase() ?? "";
    if (ext === "pdf") return "PDF";
    if (["png", "jpg", "jpeg", "gif", "webp", "heic"].includes(ext)) return "Image";
    if (["xls", "xlsx", "csv"].includes(ext)) return "Spreadsheet";
    if (["doc", "docx"].includes(ext)) return "Document";
    return "Other";
  }
  if (d.emailBody) return "Email / web";
  return undefined;
}

/** Rough size from the base64 payload — nothing stores an actual byte count. */
function estimateFileSize(dataUrl?: string): string {
  if (!dataUrl) return "—";
  const base64 = dataUrl.includes(",") ? dataUrl.slice(dataUrl.indexOf(",") + 1) : dataUrl;
  const bytes = (base64.length * 3) / 4;
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

/** Extracted so the Assets left-nav and a property's own Documents section can embed the same
 * content — passing `propertyId` locks the view to that one property (hides the property picker,
 * same lockedPropertyId pattern as LedgerTab/BillsBoard) without the page-level heading. */
export function DocumentsContent({ propertyId: lockedPropertyId }: { propertyId?: string } = {}) {
  const { state } = useStore();
  const [propertyFilter, setPropertyFilter] = useState("__all__");
  const [kind, setKind] = useState<"__all__" | DocumentEntry["kind"]>("__all__");
  const [fileFormat, setFileFormat] = useState<"__all__" | FileFormat>("__all__");
  const [tab, setTab] = useState<"all" | "needsHome">("all");
  const [query, setQuery] = useState("");
  const propertyId = lockedPropertyId ?? propertyFilter;

  const entries: DocumentEntry[] = [
    // A tenant's signed lease, ID proof and bond transfer form are entered directly on the
    // Tenant record (TenantDialog) rather than through the AI intake pipeline, so unlike every
    // other kind below these never showed up here at all until now.
    ...state.tenants.flatMap((t): DocumentEntry[] => {
      const out: DocumentEntry[] = [];
      if (t.leaseDocumentFileData) {
        out.push({
          id: `${t.id}-lease`,
          kind: "Lease Agreement",
          date: t.leaseStart ?? "",
          propertyId: t.propertyId,
          label: `${t.name} — lease agreement`,
          fileName: t.leaseDocumentFileName,
          fileData: t.leaseDocumentFileData,
        });
      }
      if (t.idProofFileData) {
        out.push({
          id: `${t.id}-id`,
          kind: "Tenant Document",
          date: t.leaseStart ?? "",
          propertyId: t.propertyId,
          label: `${t.name} — ID proof`,
          fileName: t.idProofFileName,
          fileData: t.idProofFileData,
        });
      }
      if (t.bondTransferFileData) {
        out.push({
          id: `${t.id}-bond`,
          kind: "Tenant Document",
          date: t.bondLodgementDate ?? t.leaseStart ?? "",
          propertyId: t.propertyId,
          label: `${t.name} — bond transfer form`,
          fileName: t.bondTransferFileName,
          fileData: t.bondTransferFileData,
        });
      }
      return out;
    }),
    // Past leases archived at renewal time keep their own signed document.
    ...state.leaseHistory
      .filter((h) => h.leaseDocumentFileData)
      .map((h) => {
        const tenant = state.tenants.find((t) => t.id === h.tenantId);
        return {
          id: `${h.id}-lease`,
          kind: "Lease Agreement" as const,
          date: h.pastStartDate,
          propertyId: tenant?.propertyId,
          label: `${tenant?.name ?? "Former tenant"} — lease (${h.pastStartDate} to ${h.pastEndDate})`,
          fileName: h.leaseDocumentFileName,
          fileData: h.leaseDocumentFileData,
        };
      }),
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

  const needsHome = (d: DocumentEntry) => !d.propertyId;
  // Scoped to the property picker only (not Type/File/search) — mirrors the reference design,
  // where the Insights panel and tab counts describe everything filed here, not the current
  // working filter on the table below.
  const scoped = entries.filter((d) => propertyId === "__all__" || d.propertyId === propertyId);
  const tabbed = tab === "needsHome" ? scoped.filter(needsHome) : scoped;

  const filtered = tabbed.filter((d) => {
    if (kind !== "__all__" && d.kind !== kind) return false;
    if (fileFormat !== "__all__" && fileFormatOf(d) !== fileFormat) return false;
    if (query && !`${d.label} ${d.subject ?? ""}`.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  const lastAdded = scoped.reduce<string>((latest, d) => (d.date > latest ? d.date : latest), "");
  const byType = Object.entries(
    scoped.reduce<Record<string, number>>((acc, d) => {
      acc[d.kind] = (acc[d.kind] ?? 0) + 1;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);
  const maxByType = Math.max(1, ...byType.map(([, count]) => count));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setTab("all")}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            tab === "all" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"
          }`}
        >
          All ({scoped.length})
        </button>
        <button
          type="button"
          onClick={() => setTab("needsHome")}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            tab === "needsHome" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"
          }`}
        >
          Needs a home ({scoped.filter(needsHome).length})
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Search documents…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="max-w-[220px]"
            />
            <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All types</SelectItem>
                <SelectItem value="Lease Agreement">Lease agreements</SelectItem>
                <SelectItem value="Tenant Document">Tenant documents (ID, bond)</SelectItem>
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
            <Select value={fileFormat} onValueChange={(v) => setFileFormat(v as typeof fileFormat)}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="File" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All files</SelectItem>
                {FILE_FORMATS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!lockedPropertyId && (
              <Select value={propertyFilter} onValueChange={setPropertyFilter}>
                <SelectTrigger className="w-[200px]">
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
            )}
          </div>

          <Card>
            {filtered.length === 0 ? (
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                <FolderOpen className="mx-auto mb-2 h-6 w-6" />
                No documents match these filters.
              </CardContent>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Name</th>
                      <th className="px-3 py-2 font-medium">Type</th>
                      <th className="px-3 py-2 font-medium">Size</th>
                      <th className="px-3 py-2 font-medium">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((d) => {
                      const property = state.properties.find((p) => p.id === d.propertyId);
                      return (
                        <tr key={`${d.kind}-${d.id}`} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="px-3 py-2">
                            <DocumentNameCell d={d} showProperty={!lockedPropertyId} property={property} />
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">{d.kind}</td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">{estimateFileSize(d.fileData)}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">{d.date || "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="border-t px-3 py-2 text-xs text-muted-foreground">
              {filtered.length} of {tabbed.length} document{tabbed.length === 1 ? "" : "s"}
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Documents</CardTitle>
              <div className="text-xs text-muted-foreground">
                {lockedPropertyId ? "Filed for this property" : "Filed across your portfolio"}
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="text-2xl font-semibold tracking-tight">{scoped.length}</div>
              <div className="flex items-center justify-between border-t pt-3">
                <span className="text-muted-foreground">Last added</span>
                <span className="font-medium">{lastAdded || "—"}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">By type</CardTitle>
              <div className="text-xs text-muted-foreground">Documents by category</div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {byType.length === 0 && <div className="text-xs text-muted-foreground">No documents yet.</div>}
              {byType.map(([k, count]) => (
                <div key={k}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{k}</span>
                    <span className="font-medium">{count}</span>
                  </div>
                  <div className="mt-1 h-1.5 w-full rounded-full bg-muted">
                    <div className="h-1.5 rounded-full bg-emerald-500" style={{ width: `${(count / maxByType) * 100}%` }} />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function DocumentNameCell({
  d,
  showProperty,
  property,
}: {
  d: DocumentEntry;
  showProperty: boolean;
  property?: { alias?: string; address: string };
}) {
  const [showEmail, setShowEmail] = useState(false);

  const inner = (
    <div className="flex items-center gap-2">
      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5 font-medium">
          <span className="truncate">{d.label}</span>
          {d.amount !== undefined && <span className="font-normal text-muted-foreground">{fmtCurrency(d.amount)}</span>}
          {d.status && (
            <Badge variant="secondary" className="font-normal">
              {d.status}
            </Badge>
          )}
        </div>
        {showProperty && property && (
          <div className="truncate text-xs text-muted-foreground">{property.alias || property.address}</div>
        )}
      </div>
    </div>
  );

  if (d.fileData) {
    return (
      <a href={d.fileData} download={d.fileName || "document.pdf"} className="inline-flex items-center hover:underline">
        {inner}
      </a>
    );
  }
  if (d.emailBody) {
    return (
      <>
        <button type="button" onClick={() => setShowEmail(true)} className="inline-flex items-center text-left hover:underline">
          {inner}
        </button>
        <Dialog open={showEmail} onOpenChange={setShowEmail}>
          <DialogContent className="max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{d.subject || "Email"}</DialogTitle>
            </DialogHeader>
            <pre className="whitespace-pre-wrap text-xs">{d.emailBody}</pre>
          </DialogContent>
        </Dialog>
      </>
    );
  }
  return inner;
}
