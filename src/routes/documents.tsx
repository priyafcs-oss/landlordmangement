import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useStore } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { FileText, FolderOpen, ChevronDown, ChevronUp } from "lucide-react";
import { fmtCurrency, ausFinancialYear, fyRange } from "@/lib/calculations";
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
    | "Property Sale"
    | "Management Agreement";
  /** The date this document is anchored to for period filtering/grouping/sorting — the period it
   * covers when there is one (a statement's periodStart, a lease's start date), not necessarily
   * when it was added. */
  date: string;
  /** When the underlying record was actually created — shown as "Date added", separate from
   * `date` above. Undefined for sources with no created_at wired through yet. */
  dateAdded?: string;
  /** Pre-formatted "start → end" (or a single date) for the period this document covers, when
   * there is one — e.g. a rent statement's billing period, a lease's term. Undefined when a
   * document has no real period (an ID scan, a condition report). */
  period?: string;
  propertyId?: string;
  tenantId?: string;
  label: string;
  amount?: number;
  status?: string;
  fileName?: string;
  fileData?: string;
  subject?: string;
  emailBody?: string;
}

function formatDocMonthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-AU", { month: "long", year: "numeric" });
}

/** Best-effort period range read off an AI-extracted proposal's payload — the payload union
 * doesn't share a common shape, so this checks for the fields by name rather than per-kind. */
function payloadPeriod(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const p = payload as Record<string, unknown>;
  if (typeof p.periodStart === "string" && typeof p.periodEnd === "string") return `${p.periodStart} → ${p.periodEnd}`;
  if (typeof p.effectiveFrom === "string") return `From ${p.effectiveFrom}`;
  return undefined;
}

/** The date this proposal's document actually belongs to (its period/document date), falling
 * back to when it was uploaded — used for FY filtering/grouping instead of upload date alone. */
function payloadAnchorDate(payload: unknown, documentDate: string | undefined, createdAt: string | undefined): string {
  if (payload && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    if (typeof p.periodStart === "string") return p.periodStart;
  }
  return documentDate || createdAt?.slice(0, 10) || "";
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
  const [tenantId, setTenantId] = useState("__all__");
  const [kind, setKind] = useState<"__all__" | DocumentEntry["kind"]>("__all__");
  const [fileFormat, setFileFormat] = useState<"__all__" | FileFormat>("__all__");
  const [tab, setTab] = useState<"all" | "needsHome">("all");
  const [fy, setFy] = useState("all");
  const [groupBy, setGroupBy] = useState<"none" | "month" | "fy">("none");
  const [query, setQuery] = useState("");
  const propertyId = lockedPropertyId ?? propertyFilter;

  const fys = useMemo(() => {
    const years: string[] = [];
    const currentYear = new Date().getFullYear();
    for (let y = currentYear - 3; y <= currentYear + 1; y++) years.push(`${y}-${y + 1}`);
    return years;
  }, []);

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
          dateAdded: t.created_at,
          period: t.leaseStart ? `${t.leaseStart} → ${t.leaseExpiry || "Periodic"}` : undefined,
          propertyId: t.propertyId,
          tenantId: t.id,
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
          dateAdded: t.created_at,
          propertyId: t.propertyId,
          tenantId: t.id,
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
          dateAdded: t.created_at,
          propertyId: t.propertyId,
          tenantId: t.id,
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
          dateAdded: h.created_at,
          period: `${h.pastStartDate} → ${h.pastEndDate}`,
          propertyId: tenant?.propertyId,
          tenantId: h.tenantId,
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
        dateAdded: e.created_at,
        period: e.periodStart && e.periodEnd ? `${e.periodStart} → ${e.periodEnd}` : undefined,
        propertyId: e.propertyId,
        tenantId: e.tenantId,
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
        dateAdded: i.created_at,
        propertyId: i.propertyId,
        tenantId: i.tenantId,
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
          date: payloadAnchorDate(p.payload, p.documentDate, p.created_at),
          dateAdded: p.created_at,
          period: payloadPeriod(p.payload),
          propertyId: p.propertyId,
          tenantId: p.matchedTenantId,
          label,
          status: p.status,
          fileName: p.sourceFileName,
          fileData: p.sourceFileData,
          subject: p.sourceSubject,
          emailBody: p.sourceEmailBody,
        };
      }),
    // The signed Property Management Agreement on an Agent provider — has nowhere else to live
    // as a document, and its fee terms are directly tied to a period (start → next review).
    ...state.providers
      .filter((p) => p.contractFileData)
      .map((p) => ({
        id: `${p.id}-agreement`,
        kind: "Management Agreement" as const,
        date: p.contractStartDate ?? p.created_at?.slice(0, 10) ?? "",
        dateAdded: p.created_at,
        period: p.contractStartDate
          ? `${p.contractStartDate} → ${p.contractReviewDate || "ongoing"}`
          : undefined,
        propertyId: p.propertyId,
        label: `${p.name} — management agreement`,
        fileName: p.contractFileName,
        fileData: p.contractFileData,
      })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1));

  const needsHome = (d: DocumentEntry) => !d.propertyId;
  // Scoped to the property picker only (not Type/File/search) — mirrors the reference design,
  // where the Insights panel and tab counts describe everything filed here, not the current
  // working filter on the table below.
  const scoped = entries.filter((d) => propertyId === "__all__" || d.propertyId === propertyId);
  const tabbed = tab === "needsHome" ? scoped.filter(needsHome) : scoped;

  const { start, end } = fy === "all" ? { start: "", end: "" } : fyRange(fy);

  const filtered = tabbed.filter((d) => {
    if (kind !== "__all__" && d.kind !== kind) return false;
    if (fileFormat !== "__all__" && fileFormatOf(d) !== fileFormat) return false;
    if (tenantId !== "__all__" && d.tenantId !== tenantId) return false;
    if (fy !== "all" && !(d.date >= start && d.date <= end)) return false;
    if (query && !`${d.label} ${d.fileName ?? ""} ${d.subject ?? ""}`.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  const groups = useMemo(() => {
    if (groupBy === "none") return null;
    const map = new Map<string, DocumentEntry[]>();
    for (const d of filtered) {
      const key = !d.date ? "unknown" : groupBy === "month" ? d.date.slice(0, 7) : ausFinancialYear(d.date);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(d);
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [filtered, groupBy]);

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
                <SelectItem value="Management Agreement">Management agreements</SelectItem>
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
            <Select value={fy} onValueChange={setFy}>
              <SelectTrigger className="w-[130px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All time</SelectItem>
                {fys.map((y) => (
                  <SelectItem key={y} value={y}>
                    FY {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={groupBy} onValueChange={(v) => setGroupBy(v as typeof groupBy)}>
              <SelectTrigger className="w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No grouping</SelectItem>
                <SelectItem value="month">By month</SelectItem>
                <SelectItem value="fy">By financial year</SelectItem>
              </SelectContent>
            </Select>
            <Select value={tenantId} onValueChange={setTenantId}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="All tenants" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All tenants</SelectItem>
                {state.tenants
                  .filter((t) => propertyId === "__all__" || t.propertyId === propertyId)
                  .map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
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
            {groupBy === "none" || !groups ? (
              <DocTable rows={filtered} lockedPropertyId={lockedPropertyId} />
            ) : (
              <div className="space-y-2 p-2">
                {groups.length === 0 && (
                  <div className="p-4 text-center text-sm text-muted-foreground">No documents match these filters.</div>
                )}
                {groups.map(([key, groupRows]) => (
                  <DocGroupSection
                    key={key}
                    label={key === "unknown" ? "Unknown date" : groupBy === "month" ? formatDocMonthLabel(key) : `FY ${key}`}
                    rows={groupRows}
                    lockedPropertyId={lockedPropertyId}
                  />
                ))}
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

function DocTable({ rows, lockedPropertyId }: { rows: DocumentEntry[]; lockedPropertyId?: string }) {
  const { state } = useStore();
  if (rows.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        <FolderOpen className="mx-auto mb-2 h-6 w-6" />
        No documents in this period.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="px-3 py-2 font-medium">Name</th>
            <th className="px-3 py-2 font-medium">Type</th>
            <th className="px-3 py-2 font-medium">Period</th>
            <th className="px-3 py-2 font-medium">Date added</th>
            <th className="px-3 py-2 font-medium">Size</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => {
            const property = state.properties.find((p) => p.id === d.propertyId);
            return (
              <tr key={`${d.kind}-${d.id}`} className="border-b last:border-0 hover:bg-muted/30">
                <td className="px-3 py-2">
                  <DocumentNameCell d={d} showProperty={!lockedPropertyId} property={property} />
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{d.kind}</td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">{d.period ?? d.date ?? "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">{d.dateAdded?.slice(0, 10) ?? "—"}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{estimateFileSize(d.fileData)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DocGroupSection({
  label,
  rows,
  lockedPropertyId,
}: {
  label: string;
  rows: DocumentEntry[];
  lockedPropertyId?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded border">
      <CollapsibleTrigger asChild>
        <button type="button" className="flex w-full items-center justify-between gap-2 p-3 text-left text-sm">
          <span className="flex items-center gap-2 font-medium">
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            {label}
          </span>
          <Badge variant="outline" className="font-normal">
            {rows.length} document{rows.length === 1 ? "" : "s"}
          </Badge>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t">
        <DocTable rows={rows} lockedPropertyId={lockedPropertyId} />
      </CollapsibleContent>
    </Collapsible>
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
  const primaryName = d.fileName || d.label;
  const showLabelSubtitle = !!d.fileName && !!d.label && d.label !== d.fileName;

  const inner = (
    <div className="flex items-center gap-2">
      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5 font-medium">
          <span className="truncate">{primaryName}</span>
          {d.amount !== undefined && <span className="font-normal text-muted-foreground">{fmtCurrency(d.amount)}</span>}
          {d.status && (
            <Badge variant="secondary" className="font-normal">
              {d.status}
            </Badge>
          )}
        </div>
        {showLabelSubtitle && <div className="truncate text-xs text-muted-foreground">{d.label}</div>}
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
