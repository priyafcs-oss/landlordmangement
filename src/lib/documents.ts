import type { AiIntakeProposal, AppState } from "@/lib/types";

export interface DocumentEntry {
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
    case "agency_agreement":
      return "Management Agreement";
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
    case "agency_agreement":
      return (p.payload as { agencyName?: string }).agencyName ?? "Management agreement";
    default:
      return (p.payload as { tenantName?: string }).tenantName ?? "Rent statement";
  }
}

/** Every reusable reference document across the portfolio, aggregated from every source that
 * carries one (tenants, lease history, expenses, inspections, AI intake proposals, providers) —
 * the single source every document surface (the standalone /documents page, and each property
 * tab's own "Documents" section) reads from. */
export function buildDocumentEntries(state: AppState): DocumentEntry[] {
  return [
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
    // The signed Property Management Agreement on a (provider, property) agreement — has nowhere
    // else to live as a document, and its fee terms are directly tied to a period (start → next
    // review). One entry per provider_agreements row now (a provider can hold a different signed
    // agreement, and file, at each property it manages), not one per provider.
    ...state.providerAgreements
      .filter((a) => a.contractFileData)
      .map((a) => {
        const provider = state.providers.find((p) => p.id === a.providerId);
        return {
          id: `${a.id}-agreement`,
          kind: "Management Agreement" as const,
          date: a.contractStartDate ?? a.created_at?.slice(0, 10) ?? "",
          dateAdded: a.created_at,
          period: a.contractStartDate ? `${a.contractStartDate} → ${a.contractReviewDate || "ongoing"}` : undefined,
          propertyId: a.propertyId,
          label: `${provider?.name ?? "Managing agent"} — management agreement`,
          fileName: a.contractFileName,
          fileData: a.contractFileData,
        };
      }),
  ].sort((a, b) => (a.date < b.date ? 1 : -1));
}
