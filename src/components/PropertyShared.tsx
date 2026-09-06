import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useStore } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Field, Stat } from "@/components/Field";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Building2,
  Pencil,
  Plus,
  Trash2,
  User,
  ShieldCheck,
  RefreshCw,
  FileText,
  History,
  Receipt,
  ExternalLink,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  UserCog,
  X,
  Video as VideoIcon,
  Sparkles,
  TrendingUp,
  TriangleAlert,
  IdCard,
  ArrowRight,
  Search,
  Calculator,
  Eye,
  Landmark,
  Info,
  Download,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { fmtCurrency, todayISO, ausFinancialYear, fyRange, daysUntil, daysInclusive, buildDepreciationSchedule, itemAnnualClaims, billTypeToChargeType, buildFyOptions, expenseCategoryToTaxCategory, fmtModified } from "@/lib/calculations";
import { SortableTh, toggleSort, type SortState } from "@/components/SortableTh";
import { lookupAtoEffectiveLife, ATO_EFFECTIVE_LIFE_LABELS } from "@/lib/atoEffectiveLife";
import { findMatchingUnpaidBill, findDuplicateLedgerEntry, findDuplicateRecord, findDuplicateDepreciationReport } from "@/lib/billMatch";
import {
  verifyAgentFees,
  reconcileFlatFees,
  hasFeeTerms,
  collectAgentFeeLines,
  isAgentFeeExpense,
  summarizeFeeChecksByType,
  categorizeAgentStatementLine,
  type FeeCheckResult,
  type AgreementFeeTerms,
} from "@/lib/feeVerification";
import type {
  Property,
  Tenant,
  RentFrequency,
  LeaseDuration,
  RepaymentFrequency,
  BillType,
  BillLineItem,
  PropertyBill,
  AiIntakeProposal,
  TenantLeaseProposalPayload,
  RentLedgerProposalPayload,
  PropertyDetailProposalPayload,
  BillProposalPayload,
  ExpenseProposalPayload,
  RentChange,
  LeaseHistory,
  ContactPerson,
  Provider,
  ProviderAgreement,
  ProviderRole,
  FeeFrequency,
  DepreciationItem,
  DepreciationReportProposalPayload,
  UnclassifiedProposalPayload,
  LoanDocumentProposalPayload,
  LoanStatementProposalPayload,
  LoanStatementLineItem,
  BankStatementProposalPayload,
  PropertySaleProposalPayload,
  AgencyAgreementProposalPayload,
  Loan,
  Expense,
  PropertyUnit,
  Entity,
  ExpenseCategory,
} from "@/lib/types";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, PROVIDER_ROLE_LABELS } from "@/lib/types";
import { toast } from "sonner";
import { BillsBoard } from "@/components/BillsBoard";
import { UploadDocumentDialog } from "@/components/UploadDocumentDialog";
import { AddBillDialog } from "@/components/AddBillDialog";
import { AddTransactionDialog } from "@/components/AddTransactionDialog";
import { AddDepreciationReportDialog } from "@/components/AddDepreciationReportDialog";
import { DocumentReviewCard, ReviewLaterContext } from "@/components/DocumentReviewCard";
import { Checkbox } from "@/components/ui/checkbox";
import { fillLeaseTemplate, toDDMMYYYY, appendPdf, SMOKE_ALARM_BATTERY_TYPES } from "@/lib/leaseTemplate";
import { downloadBlob, downloadPdfAndEmailViaGmail } from "@/lib/emailPdf";
import { supabase } from "@/integrations/supabase/client";
import { openBillDocument, MAX_AI_UPLOAD_BYTES, formatFileSize, readFileAsDataUrl, readFileAsBase64 } from "@/lib/files";
import { DocumentLink } from "@/components/DocumentLink";
import { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent, type ChartConfig } from "@/components/ui/chart";
import { ComposedChart, Line, XAxis, YAxis, CartesianGrid } from "recharts";
import { DocumentsSection, DocumentsPanel, fileFormatOf, FILE_FORMATS, type FileFormat } from "@/components/DocumentEntryRow";
import { buildDocumentEntries } from "@/lib/documents";
import { bucketBy } from "@/lib/group";
import { downloadCsv } from "@/lib/csv";
import { chargeTypeForCategory, buildRechargeInvoice } from "@/lib/recharge";
import { latestAgreementFor } from "@/lib/providerAgreements";
import { FileSignature } from "lucide-react";

const uid = (p: string) => p + "_" + Math.random().toString(36).slice(2, 10);
/** Sentinel for "no specific dwelling" in a Dwelling Select — Radix Select item values can't be
 * an empty string, and shared/whole-property genuinely needs its own selectable option. */
const SHARED_UNIT = "__shared__";

interface DomainSuggestResult {
  ok?: boolean;
  suggestions?: { id: string; address: string }[];
  error?: string;
}
interface DomainDetailsResult {
  ok?: boolean;
  bedrooms?: number | null;
  bathrooms?: number | null;
  carSpaces?: number | null;
  landSizeSqm?: number | null;
  domainPropertyType?: string | null;
  error?: string;
}


/** Pending AI-extracted proposals (new tenant leases, property-detail updates, rent statements)
 * awaiting review — surfaced on the Assets page since that's the entry point for properties now. */
export function AiProposalsSection() {
  const { state, dismissProposal } = useStore();
  const pending = state.aiProposals.filter((p) => p.status === "pending");
  if (pending.length === 0) return null;

  return (
    <Card className="border-amber-500/50 bg-amber-500/5">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-amber-600" />
          AI Proposals ({pending.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {pending.map((p) => (
          <ProposalCard key={p.id} proposal={p} onDismiss={() => dismissProposal(p.id)} />
        ))}
      </CardContent>
    </Card>
  );
}

/** Picks the right kind-specific review card for a single proposal. Shared by `AiProposalsSection`
 * (the Assets-page pending list) and `ProposalReviewDialog` (the immediately-after-upload popup). */
export function ProposalCard({ proposal, onDismiss }: { proposal: AiIntakeProposal; onDismiss: () => void }) {
  switch (proposal.kind) {
    case "bill":
      return <BillProposalRow proposal={proposal} onDismiss={onDismiss} />;
    case "expense":
      return <ExpenseProposalRow proposal={proposal} onDismiss={onDismiss} />;
    case "tenant_lease":
      return <TenantLeaseProposalCard proposal={proposal} onDismiss={onDismiss} />;
    case "property_detail":
      return <PropertyDetailProposalCard proposal={proposal} onDismiss={onDismiss} />;
    case "depreciation_report":
      return <DepreciationReportProposalCard proposal={proposal} onDismiss={onDismiss} />;
    case "unclassified":
      return <UnclassifiedProposalCard proposal={proposal} onDismiss={onDismiss} />;
    case "loan_document":
      return <LoanDocumentProposalCard proposal={proposal} onDismiss={onDismiss} />;
    case "loan_statement":
      return <LoanStatementProposalCard proposal={proposal} onDismiss={onDismiss} />;
    case "bank_statement":
      return <BankStatementProposalCard proposal={proposal} onDismiss={onDismiss} />;
    case "property_sale":
      return <PropertySaleProposalCard proposal={proposal} onDismiss={onDismiss} />;
    case "agency_agreement":
      return <AgencyAgreementProposalCard proposal={proposal} onDismiss={onDismiss} />;
    default:
      return <RentLedgerProposalCard proposal={proposal} onDismiss={onDismiss} />;
  }
}

/** Compact pending-list row for a "bill" proposal — Review opens the real Add Bill dialog
 * (pre-filled via initialProposal), the same form/logic used everywhere else a bill is entered,
 * instead of a separate lighter-weight card that could drift out of sync with it. */
function BillProposalRow({ proposal, onDismiss }: { proposal: AiIntakeProposal; onDismiss: () => void }) {
  const [open, setOpen] = useState(false);
  const payload = proposal.payload as BillProposalPayload;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded border p-2 text-xs">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Badge variant="secondary">Bill</Badge>
        <span className="font-medium">{proposal.providerName || "Unknown vendor"}</span>
        <span className="text-muted-foreground">
          {fmtCurrency(payload.amount)} due {payload.dueDate}
        </span>
        {(proposal.reviewReason ?? "")
          .split("; ")
          .filter(Boolean)
          .map((r) => (
            <Badge key={r} variant="destructive">
              {r}
            </Badge>
          ))}
      </div>
      <div className="flex shrink-0 gap-2">
        <Button size="sm" onClick={() => setOpen(true)}>
          Review
        </Button>
        <Button size="sm" variant="outline" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
      <AddBillDialog initialProposal={proposal} open={open} onOpenChange={setOpen} />
    </div>
  );
}

/** Compact pending-list row for an "expense" proposal — same pattern as BillProposalRow, opening
 * the real Add Transaction dialog instead of a separate review card. */
function ExpenseProposalRow({ proposal, onDismiss }: { proposal: AiIntakeProposal; onDismiss: () => void }) {
  const [open, setOpen] = useState(false);
  const payload = proposal.payload as ExpenseProposalPayload;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded border p-2 text-xs">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Badge variant="secondary">Transaction</Badge>
        <span className="font-medium">{payload.itemName}</span>
        <span className="text-muted-foreground">
          {fmtCurrency(payload.cost)} • {payload.date}
        </span>
        {(proposal.reviewReason ?? "")
          .split("; ")
          .filter(Boolean)
          .map((r) => (
            <Badge key={r} variant="destructive">
              {r}
            </Badge>
          ))}
      </div>
      <div className="flex shrink-0 gap-2">
        <Button size="sm" onClick={() => setOpen(true)}>
          Review
        </Button>
        <Button size="sm" variant="outline" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
      <AddTransactionDialog initialProposal={proposal} open={open} onOpenChange={setOpen} />
    </div>
  );
}

/** Pops a single pending proposal open for review right away — used right after Upload Document
 * stages one, so the landlord isn't left hunting for it in Assets/Documents. Looks the proposal up
 * live from the store (rather than taking it as a prop) so it auto-closes the instant Approve or
 * Dismiss flips its status away from "pending"; closing any other way (the X, outside-click, or the
 * explicit "Review later" button) leaves it untouched and pending in Assets/Documents. */
export function ProposalReviewDialog({
  proposalId,
  onOpenChange,
}: {
  proposalId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { state, dismissProposal } = useStore();
  const proposal = proposalId ? state.aiProposals.find((p) => p.id === proposalId) : undefined;
  const isPending = proposal?.status === "pending";

  useEffect(() => {
    if (proposalId && !isPending) onOpenChange(false);
  }, [proposalId, isPending, onOpenChange]);

  if (!proposal || !isPending) return null;

  // Bills and one-off transactions get the real Add Bill / Add Transaction forms, pre-filled
  // from what was already extracted — the same forms used for manual entry, not a lighter-weight
  // review-only card, so editing an AI-found bill feels identical to adding one by hand. Every
  // other kind (lease, property document, loan, etc.) doesn't have an equivalent standalone "Add"
  // form to reuse, so those stay on the purpose-built review cards below.
  if (proposal.kind === "bill") {
    return <AddBillDialog initialProposal={proposal} open onOpenChange={onOpenChange} />;
  }
  if (proposal.kind === "expense") {
    return <AddTransactionDialog initialProposal={proposal} open onOpenChange={onOpenChange} />;
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Review document</DialogTitle>
        </DialogHeader>
        <ReviewLaterContext.Provider value={() => onOpenChange(false)}>
          <ProposalCard
            key={proposal.id}
            proposal={proposal}
            onDismiss={() => {
              dismissProposal(proposal.id);
              onOpenChange(false);
            }}
          />
        </ReviewLaterContext.Provider>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Review later
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TenantLeaseProposalCard({ proposal, onDismiss }: { proposal: AiIntakeProposal; onDismiss: () => void }) {
  const { state, markProposalApplied } = useStore();
  const payload = proposal.payload as TenantLeaseProposalPayload;
  const [propertyId, setPropertyId] = useState(proposal.propertyId ?? "");

  return (
    <DocumentReviewCard proposal={proposal}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">Lease agreement</Badge>
          <span className="font-medium">{payload.name}</span>
          <span className="text-xs text-muted-foreground">
            {fmtCurrency(payload.rentAmount)}/{payload.rentFrequency}
          </span>
        </div>
        <div className="text-xs text-muted-foreground">
          {payload.leaseStart || "—"} → {payload.leaseExpiry || "Periodic"}
          {payload.bondAmount ? ` • Bond ${fmtCurrency(payload.bondAmount)}` : ""}
        </div>

        {!proposal.propertyId && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-destructive">
              No property matched{proposal.rawPropertyAddress ? ` — "${proposal.rawPropertyAddress}"` : ""}
            </span>
            <Select value={propertyId} onValueChange={setPropertyId}>
              <SelectTrigger className="h-7 w-[220px] text-xs">
                <SelectValue placeholder="Assign property" />
              </SelectTrigger>
              <SelectContent>
                {state.properties.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.alias || p.address}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <TenantDialog
            propertyId={propertyId}
            initialValues={{
              name: payload.name,
              email: payload.email,
              phone: payload.phone,
              rentAmount: payload.rentAmount,
              rentFrequency: payload.rentFrequency,
              leaseStart: payload.leaseStart,
              leaseExpiry: payload.leaseExpiry,
              leaseDuration: payload.leaseDuration,
              bondAmount: payload.bondAmount,
              leaseDocumentFileName: proposal.sourceFileName,
              leaseDocumentFileData: proposal.sourceFileData,
            }}
            onSaved={() => markProposalApplied(proposal.id, { propertyId })}
          >
            <Button size="sm" disabled={!propertyId}>
              Review &amp; Create Tenant
            </Button>
          </TenantDialog>
          <Button size="sm" variant="outline" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
    </DocumentReviewCard>
  );
}

const PROPERTY_DETAIL_FIELDS: { key: keyof PropertyDetailProposalPayload; label: string; kind: "currency" | "date" | "text" }[] = [
  { key: "purchaseDate", label: "Settlement date", kind: "date" },
  { key: "purchasePrice", label: "Purchase price", kind: "currency" },
  { key: "stampDuty", label: "Stamp duty", kind: "currency" },
  { key: "deposit", label: "Deposit", kind: "currency" },
  { key: "insurerName", label: "Insurer", kind: "text" },
  { key: "insurancePolicyNumber", label: "Policy number", kind: "text" },
  { key: "insurancePremium", label: "Premium", kind: "currency" },
  { key: "insuranceSumInsured", label: "Sum insured", kind: "currency" },
  { key: "insuranceRenewalDate", label: "Insurance renewal date", kind: "date" },
  { key: "strataLevyAmount", label: "Strata levy amount", kind: "currency" },
  { key: "strataLevyFrequency", label: "Strata levy frequency", kind: "text" },
  { key: "smokeAlarmCheckDueDate", label: "Smoke alarm check due", kind: "date" },
  { key: "poolSafetyCertExpiry", label: "Pool safety cert expiry", kind: "date" },
  { key: "electricalSafetyCertExpiry", label: "Electrical safety cert expiry", kind: "date" },
  { key: "gasSafetyCertExpiry", label: "Gas safety cert expiry", kind: "date" },
];

const ENTITY_TYPES: Entity["type"][] = ["Individual", "Joint", "Trust", "SMSF", "Company"];
function mapOwnershipType(raw?: string): Entity["type"] {
  const exact = ENTITY_TYPES.find((t) => t.toLowerCase() === (raw ?? "").trim().toLowerCase());
  if (exact) return exact;
  const c = (raw ?? "").toLowerCase();
  if (c.includes("joint")) return "Joint";
  if (c.includes("smsf") || c.includes("super")) return "SMSF";
  if (c.includes("trust")) return "Trust";
  if (c.includes("pty") || c.includes("ltd") || c.includes("company")) return "Company";
  return "Individual";
}

function PropertyDetailProposalCard({ proposal, onDismiss }: { proposal: AiIntakeProposal; onDismiss: () => void }) {
  const { state, updateProperty, markProposalApplied, findOrCreateEntity, addExpense } = useStore();
  const payload = proposal.payload as PropertyDetailProposalPayload;
  const [propertyId, setPropertyId] = useState(proposal.propertyId ?? "");

  const presentFields = PROPERTY_DETAIL_FIELDS.filter((f) => payload[f.key] !== undefined && payload[f.key] !== null);
  const [checked, setChecked] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(presentFields.map((f) => [f.key, true])),
  );
  // Editable copies of the extracted values — the AI's read is a starting point, not gospel;
  // the landlord can correct a wrong date/amount/name here rather than dismiss-and-reupload.
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      presentFields.map((f) => [f.key, payload[f.key] === undefined || payload[f.key] === null ? "" : String(payload[f.key])]),
    ),
  );
  const [ownerChecked, setOwnerChecked] = useState(!!payload.ownerName);
  const [ownerName, setOwnerName] = useState(payload.ownerName ?? "");
  const [ownershipType, setOwnershipType] = useState<Entity["type"]>(mapOwnershipType(payload.ownershipType));
  const adjustments = payload.settlementAdjustments ?? [];
  const [adjustmentsIncluded, setAdjustmentsIncluded] = useState<boolean[]>(() => adjustments.map(() => true));

  const confirm = () => {
    if (!propertyId) return toast.error("Select a property first");
    const patch: Record<string, unknown> = {};
    presentFields.forEach((f) => {
      if (!checked[f.key]) return;
      const raw = values[f.key] ?? "";
      if (raw === "") return;
      patch[f.key] = f.kind === "currency" ? parseFloat(raw) || 0 : raw;
    });
    if (ownerChecked && ownerName.trim()) {
      patch.entityId = findOrCreateEntity(ownerName.trim(), ownershipType);
    }
    const includedAdjustments = adjustments.filter((_, i) => adjustmentsIncluded[i]);
    if (Object.keys(patch).length === 0 && includedAdjustments.length === 0) {
      return toast.error("Select at least one field to apply");
    }
    if (Object.keys(patch).length > 0) updateProperty(propertyId, patch);
    for (const adj of includedAdjustments) {
      addExpense({
        itemName: adj.description,
        cost: adj.amount,
        date: payload.purchaseDate || todayISO(),
        propertyId,
        category: "Purchase Cost",
        taxCategory: "Capital Works",
        hasWarranty: false,
        rechargeToTenant: false,
        status: "approved",
        source: "upload",
        notes: "Settlement adjustment from a PEXA record / Statement of Adjustments.",
        sourceFileName: proposal.sourceFileName,
        sourceFileData: proposal.sourceFileData,
      });
    }
    markProposalApplied(proposal.id, { propertyId });
    toast.success(ownerChecked && ownerName.trim() ? "Property details updated — entity linked" : "Property details updated");
  };

  return (
    <DocumentReviewCard proposal={proposal}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{payload.documentCategory}</Badge>
          {proposal.rawPropertyAddress && <span className="text-xs text-muted-foreground">{proposal.rawPropertyAddress}</span>}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-xs ${proposal.propertyId ? "text-muted-foreground" : "text-destructive"}`}>
            {proposal.propertyId ? "Property (wrong match? change it):" : "No property matched — assign one:"}
          </span>
          <Select value={propertyId} onValueChange={setPropertyId}>
            <SelectTrigger className="h-7 w-[220px] text-xs">
              <SelectValue placeholder="Assign property" />
            </SelectTrigger>
            <SelectContent>
              {state.properties.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.alias || p.address}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {payload.ownerName && (
          <div className="space-y-2 rounded border border-emerald-300 bg-emerald-50 p-2 text-xs">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={ownerChecked} onChange={(e) => setOwnerChecked(e.target.checked)} />
              <span>Owner — will find or create this entity and link it to this property</span>
            </label>
            <div className="flex flex-wrap items-center gap-2 pl-6">
              <Input
                className="h-7 w-56 text-xs"
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                placeholder="Owner name"
              />
              <Select value={ownershipType} onValueChange={(v) => setOwnershipType(v as Entity["type"])}>
                <SelectTrigger className="h-7 w-[140px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENTITY_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {presentFields.length === 0 && !payload.ownerName && adjustments.length === 0 ? (
          <div className="text-xs text-muted-foreground">No usable fields found on this document.</div>
        ) : presentFields.length > 0 ? (
          <div className="space-y-1 rounded border p-2">
            <div className="text-[11px] font-medium text-muted-foreground">Apply to property</div>
            {presentFields.map((f) => (
              <label key={f.key} className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={checked[f.key] ?? false}
                  onChange={(e) => setChecked((c) => ({ ...c, [f.key]: e.target.checked }))}
                />
                <span className="w-40 shrink-0 text-muted-foreground">{f.label}</span>
                <Input
                  className="h-7 flex-1 text-xs"
                  type={f.kind === "date" ? "date" : f.kind === "currency" ? "number" : "text"}
                  value={values[f.key] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                />
              </label>
            ))}
          </div>
        ) : null}

        {adjustments.length > 0 && (
          <div className="space-y-1 rounded border p-2">
            <div className="text-[11px] font-medium text-muted-foreground">
              Settlement adjustments → Capital Works expenses
            </div>
            {adjustments.map((adj, i) => (
              <label key={i} className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={adjustmentsIncluded[i]}
                  onChange={(e) => setAdjustmentsIncluded((inc) => inc.map((v, j) => (j === i ? e.target.checked : v)))}
                />
                <span className="flex-1 truncate">{adj.description}</span>
                <span className="font-medium">{fmtCurrency(adj.amount)}</span>
              </label>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            size="sm"
            disabled={!propertyId || (presentFields.length === 0 && !payload.ownerName && adjustments.length === 0)}
            onClick={confirm}
          >
            Apply selected fields
          </Button>
          <Button size="sm" variant="outline" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
    </DocumentReviewCard>
  );
}

/** Sentinel for "no specific tenant" in the expense-line assignment Select — Radix Select
 * item values can't be an empty string, and unassigned/shared genuinely needs its own real
 * selectable option here (unlike the transaction row Select, where an empty value just means
 * "nothing picked yet" and is never itself a valid choice). */
const SHARED_EXPENSE_TENANT = "__shared__";

/** A rent statement's income section sometimes carries a line that isn't rent at all — most
 * commonly a utility usage charge the agent invoiced and collected from the tenant alongside
 * rent (e.g. "Inv:8827, WATER USAGE") — extracted into `transactions` since it's still money
 * credited to the owner, even though the parsing prompt otherwise reserves that array for rent.
 * Two things depend on telling them apart: the ledger type it's posted under ("Rent Payment" vs
 * "Water Invoice" — see LedgerType), and the rent base a % management fee is calculated against,
 * which should never include a recharge that was never actually rent. */
function isRentTransaction(description: string): boolean {
  return !/\bwater\b|\busage\b|\binv\s*[:#]/i.test(description);
}

function RentLedgerProposalCard({ proposal, onDismiss }: { proposal: AiIntakeProposal; onDismiss: () => void }) {
  const { state, addLedger, addExpense, addInvoice, findOrCreateProvider, markBillPaid, markProposalApplied, refresh } = useStore();
  const payload = proposal.payload as RentLedgerProposalPayload;
  const [propertyId, setPropertyId] = useState(proposal.propertyId ?? "");
  const expenseLines = payload.expenseLines ?? [];

  // The AI extraction is a starting point, not gospel — a line can land in the wrong section
  // (a tenant-paid recharge parsed as a deduction instead of income, or vice versa), have a wrong
  // amount, or be missing entirely. These editable copies let the reviewer fix any of that before
  // anything is posted; payload/expenseLines above stay untouched and are only used to seed the
  // initial per-row state below (tenant assignment, included flags) keyed to the original order.
  type TxRow = RentLedgerProposalPayload["transactions"][number];
  type ExpRow = NonNullable<RentLedgerProposalPayload["expenseLines"]>[number];
  const [txRows, setTxRows] = useState<TxRow[]>(() => payload.transactions.map((t) => ({ ...t })));
  const [expRows, setExpRows] = useState<ExpRow[]>(() => expenseLines.map((e) => ({ ...e })));
  const updateTxRow = (i: number, patch: Partial<TxRow>) => setTxRows((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const updateExpRow = (i: number, patch: Partial<ExpRow>) => setExpRows((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const tenantsAtProperty = propertyId ? state.tenants.filter((t) => t.propertyId === propertyId) : state.tenants;
  // A changeover statement (outgoing + incoming tenant in the same period) needs each line
  // attributed individually rather than one tenant picked for the whole statement — but that's
  // only ever ambiguous when the property actually has more than one tenant on file.
  const multiTenant = tenantsAtProperty.length > 1;
  const nameMatchesExistingTenant = (name: string) => tenantsAtProperty.some((t) => t.name.trim().toLowerCase() === name.trim().toLowerCase());
  // Checked against every name the statement mentions at all — its own top-level tenantName AND
  // every transaction's own tenantName — not just the top-level field, since that's often left
  // blank on statements the AI didn't extract an overall name for (not only changeover ones), even
  // though individual lines still carry a real name that may not match who's currently on file.
  const unmatchedStatementTenantName = [payload.tenantName, ...payload.transactions.map((t) => t.tenantName)]
    .filter((n): n is string => !!n)
    .find((n) => !nameMatchesExistingTenant(n));

  /** Best guess for one transaction row: its own extracted tenantName (changeover statements) >
   * the sole tenant at the property > whatever the server-side matcher resolved for the whole
   * statement. Left blank (forcing a manual pick) when none of those apply. */
  const defaultTenantFor = (name?: string): string => {
    if (name) {
      const q = name.trim().toLowerCase();
      const match = tenantsAtProperty.find((t) => t.name.trim().toLowerCase() === q);
      if (match) return match.id;
    }
    if (tenantsAtProperty.length === 1) return tenantsAtProperty[0].id;
    return proposal.matchedTenantId ?? "";
  };

  const [txTenantIds, setTxTenantIds] = useState<string[]>(() =>
    payload.transactions.map((tx) => defaultTenantFor(tx.tenantName)),
  );
  // Rows that already look like a duplicate of a ledger entry that exists at mount time start
  // unchecked, so the landlord has to actively opt back in rather than silently re-posting them.
  const [included, setIncluded] = useState<boolean[]>(() =>
    payload.transactions.map((tx) => {
      const tId = defaultTenantFor(tx.tenantName);
      return tId ? !findDuplicateLedgerEntry(state.ledger, { tenantId: tId, amount: tx.amount, date: tx.date }) : true;
    }),
  );
  const ledgerDuplicates = txRows.map((tx, i) =>
    txTenantIds[i] ? findDuplicateLedgerEntry(state.ledger, { tenantId: txTenantIds[i], amount: tx.amount, date: tx.date }) : null,
  );
  // Rows that already look like a duplicate of a Bill/Expense that exists at mount time start
  // unchecked too — same guardrail as the rent-income rows above (findDuplicateLedgerEntry),
  // just against Bills/Expenses via findDuplicateRecord since a deduction posts as an Expense,
  // not a ledger entry. Previously this array always defaulted to true with no check at all,
  // so re-approving the same statement (or an overlapping one) silently double-booked agent fees.
  const [expensesIncluded, setExpensesIncluded] = useState<boolean[]>(() =>
    expenseLines.map(
      (e) =>
        !findDuplicateRecord(state.bills, state.expenses, {
          propertyId: propertyId || undefined,
          vendorOrDescription: e.vendor,
          amount: e.amount,
          date: e.date,
        }),
    ),
  );
  const expenseDuplicates = expRows.map((e) =>
    findDuplicateRecord(state.bills, state.expenses, {
      propertyId: propertyId || undefined,
      vendorOrDescription: e.vendor,
      amount: e.amount,
      date: e.date,
    }),
  );
  // Deductions default to the one tenant every included payment is already going to (the common
  // single-tenant case) — left "shared" whenever more than one tenant is actually involved, since
  // which tenant (if any) a given fee line relates to isn't something to guess at.
  const soleTxTenant = (() => {
    const ids = new Set(payload.transactions.map((tx) => defaultTenantFor(tx.tenantName)).filter(Boolean));
    return ids.size === 1 ? [...ids][0] : SHARED_EXPENSE_TENANT;
  })();
  const [expTenantIds, setExpTenantIds] = useState<string[]>(() => expenseLines.map(() => soleTxTenant));
  // Always defaults off, even for a water charge with a specific tenant assigned — a statement's
  // "Water Charges" deduction line is usually the FULL bill (fixed service/access charges plus
  // usage), and only the usage portion is the tenant's to pay; ticking this recharges the whole
  // line amount, so the landlord has to deliberately opt in (and, ideally, edit the amount down
  // to just the usage component first) rather than have it silently pre-checked.
  const [rechargeIncluded, setRechargeIncluded] = useState<boolean[]>(() => expenseLines.map(() => false));
  // The water-charge caveat below is only worth full sentences once — a statement with several
  // deduction lines was showing that same paragraph in full under every single one of them.
  // Collapsed by default; a small "Why?" toggle reveals it per line.
  const [waterHintExpanded, setWaterHintExpanded] = useState<boolean[]>(() => expenseLines.map(() => false));
  // An agent statement's deduction is often just reporting that a bill already sitting in
  // Bills/Unpaid was paid on the owner's behalf — suggest marking THAT bill paid instead of
  // creating a second, disconnected Expense for the same real-world payment.
  const billMatches = expRows.map((e) =>
    findMatchingUnpaidBill(state.bills, { propertyId, vendorOrDescription: e.vendor, amount: e.amount, date: e.date }),
  );
  const [matchAsBill, setMatchAsBill] = useState<boolean[]>(() => billMatches.map((m) => !!m));

  // A reviewer can add a missing line, delete a spurious one, or move one that the AI put in the
  // wrong section entirely (e.g. a tenant-paid recharge parsed as a deduction instead of income —
  // see the original bug report this was added for). Each helper keeps every index-parallel
  // per-row array (included/tenant assignment/bill-match) in sync with the row list it belongs to.
  const addTxRow = () => {
    setTxRows((rows) => [...rows, { date: todayISO(), amount: 0, description: "" }]);
    setIncluded((v) => [...v, true]);
    setTxTenantIds((v) => [...v, defaultTenantFor(undefined)]);
  };
  const removeTxRow = (i: number) => {
    setTxRows((rows) => rows.filter((_, j) => j !== i));
    setIncluded((v) => v.filter((_, j) => j !== i));
    setTxTenantIds((v) => v.filter((_, j) => j !== i));
  };
  const addExpRow = () => {
    setExpRows((rows) => [...rows, { vendor: "", amount: 0, date: todayISO(), description: "", category: "" }]);
    setExpensesIncluded((v) => [...v, true]);
    setExpTenantIds((v) => [...v, soleTxTenant]);
    setMatchAsBill((v) => [...v, false]);
    setRechargeIncluded((v) => [...v, false]);
    setWaterHintExpanded((v) => [...v, false]);
  };
  const removeExpRow = (i: number) => {
    setExpRows((rows) => rows.filter((_, j) => j !== i));
    setExpensesIncluded((v) => v.filter((_, j) => j !== i));
    setExpTenantIds((v) => v.filter((_, j) => j !== i));
    setMatchAsBill((v) => v.filter((_, j) => j !== i));
    setRechargeIncluded((v) => v.filter((_, j) => j !== i));
    setWaterHintExpanded((v) => v.filter((_, j) => j !== i));
  };
  /** The AI sometimes puts a line in the wrong section entirely — a tenant-paid recharge parsed
   * as a deduction, or (more rarely) an agent charge parsed as income. Moving converts between
   * the two row shapes: an expense's vendor becomes the income line's description (and vice
   * versa), since that's the field actually shown/used for identifying the line either way. */
  const moveExpToIncome = (i: number) => {
    const e = expRows[i];
    removeExpRow(i);
    setTxRows((rows) => [...rows, { date: e.date, amount: e.amount, description: [e.vendor, e.description].filter(Boolean).join(" — ") }]);
    setIncluded((v) => [...v, true]);
    setTxTenantIds((v) => [...v, defaultTenantFor(undefined)]);
  };
  const moveTxToExpense = (i: number) => {
    const t = txRows[i];
    removeTxRow(i);
    setExpRows((rows) => [...rows, { vendor: t.description, amount: t.amount, date: t.date, description: "", category: "" }]);
    setExpensesIncluded((v) => [...v, true]);
    setExpTenantIds((v) => [...v, soleTxTenant]);
    setMatchAsBill((v) => [...v, false]);
    setRechargeIncluded((v) => [...v, false]);
    setWaterHintExpanded((v) => [...v, false]);
  };

  const includedIncome = txRows.reduce((s, tx, i) => (included[i] ? s + tx.amount : s), 0);
  const includedExpenses = expRows.reduce((s, e, i) => (expensesIncluded[i] ? s + e.amount : s), 0);
  const computedNet = includedIncome - includedExpenses;
  // A statement can show a running balance the agent holds between periods — when it does, the
  // amount actually paid to the owner is this period's activity adjusted by that rollover, not
  // period income/expenses alone (see LEDGER_PROMPT in parse-ledger.ts).
  const hasBalanceRollover = payload.openingBalance !== undefined || payload.closingBalance !== undefined;
  const reconciledNet = computedNet + (payload.openingBalance ?? 0) - (payload.closingBalance ?? 0);

  const agentProviderIds = new Set(
    state.providerProperties.filter((pp) => pp.propertyId === propertyId).map((pp) => pp.providerId),
  );
  const agent = state.providers.find((p) => agentProviderIds.has(p.id) && p.role === "Agent");
  const agentAgreement = agent ? latestAgreementFor(state.providerAgreements, agent.id, propertyId) : undefined;
  const assignedIncludedTenantIds = [...new Set(txRows.filter((_, i) => included[i]).map((_, i) => txTenantIds[i]).filter(Boolean))];
  const singleAssignedTenant =
    assignedIncludedTenantIds.length === 1 ? state.tenants.find((t) => t.id === assignedIncludedTenantIds[0]) : undefined;
  // A % management fee is charged on rent only — a recharge like a water-usage invoice riding
  // along in the same income section (see isRentTransaction) inflates the agreed amount if it's
  // included here, even though includedIncome/computedNet above correctly count it for the
  // statement's own net-to-owner reconciliation.
  const rentOnlyIncome = txRows.reduce(
    (s, tx, i) => (included[i] && isRentTransaction(tx.description) ? s + tx.amount : s),
    0,
  );
  const feeChecks: FeeCheckResult[] =
    agent && agentAgreement && hasFeeTerms(agentAgreement)
      ? verifyAgentFees({
          agentName: agent.name,
          agreement: agentAgreement,
          rentCollected: rentOnlyIncome,
          lines: expRows.filter((_, i) => expensesIncluded[i]),
          tenantRent: singleAssignedTenant ? { amount: singleAssignedTenant.rentAmount, frequency: singleAssignedTenant.rentFrequency } : undefined,
        })
      : [];

  const confirm = () => {
    if (txRows.some((_, i) => included[i] && !txTenantIds[i])) {
      return toast.error("Assign a tenant to every included payment first");
    }
    txRows.forEach((tx, i) => {
      if (!included[i]) return;
      addLedger({
        tenantId: txTenantIds[i],
        date: tx.date,
        type: isRentTransaction(tx.description) ? "Rent Payment" : "Water Invoice",
        description: tx.description,
        debit: 0,
        credit: tx.amount,
        source: "agent_statement",
        sourceFileName: proposal.sourceFileName,
        sourceFileData: proposal.sourceFileData,
      });
    });
    let rechargedCount = 0;
    expRows.forEach((e, i) => {
      if (!expensesIncluded[i]) return;
      const match = billMatches[i];
      if (match && matchAsBill[i]) {
        markBillPaid(match.id, { paidDate: e.date });
        return;
      }
      // A statement deduction is only the agent's own fee when it's actually paid to the agent or
      // reads as one (management/admin/letting/etc.) — a water bill or tradesperson invoice the
      // agent merely paid on the owner's behalf gets its own real category instead.
      const lineCategory = categorizeAgentStatementLine(e, agent?.name);
      const lineProviderId = e.vendor.trim() ? findOrCreateProvider(e.vendor.trim(), propertyId || undefined, lineCategory) : undefined;
      const lineTenantId = expTenantIds[i];
      const realTenantId = lineTenantId && lineTenantId !== SHARED_EXPENSE_TENANT ? lineTenantId : undefined;
      const recharge = rechargeIncluded[i] && !!realTenantId;
      addExpense({
        itemName: e.description.trim() || e.vendor,
        cost: e.amount,
        date: e.date,
        propertyId: propertyId || undefined,
        taxCategory: "Immediate Deduction",
        category: lineCategory,
        providerName: e.vendor,
        providerId: lineProviderId,
        // The AI's raw free-text classification (e.g. "management_fees") — kept even though
        // itemName now carries the line's own description too, since classifyFeeLine's keyword
        // match runs on this once the line becomes a plain Expense row (see feeVerification.ts).
        notes: e.category || undefined,
        hasWarranty: false,
        rechargeToTenant: recharge,
        tenantId: realTenantId,
        status: "approved",
        source: "agent_statement",
        rawPropertyAddress: proposal.rawPropertyAddress,
        sourceSubject: proposal.sourceSubject,
        sourceEmailBody: proposal.sourceEmailBody,
        sourceFileName: proposal.sourceFileName,
        sourceFileData: proposal.sourceFileData,
      });
      if (recharge) {
        rechargedCount++;
        addInvoice(
          buildRechargeInvoice({
            tenantId: realTenantId!,
            chargeType: chargeTypeForCategory(lineCategory),
            amount: e.amount,
            date: e.date,
            description: e.vendor,
          }),
        );
      }
    });
    markProposalApplied(proposal.id, { propertyId });
    toast.success(
      rechargedCount > 0
        ? `Rent payments and expenses added — ${rechargedCount} recharged to tenant`
        : expRows.some((_, i) => expensesIncluded[i])
          ? "Rent payments and expenses added"
          : "Rent payments added",
    );
  };

  // Re-runs extraction on this same document with the same rent-statement parser (see
  // UnclassifiedProposalCard's identical use of this function) — useful when a line was
  // misread or misclassified and might come out right on a second pass. Deletes this proposal
  // row once the replacement is confirmed written, so there's never a stale duplicate left behind.
  const [reparsing, setReparsing] = useState(false);
  const reparse = async () => {
    if (!proposal.sourceFileData) return;
    setReparsing(true);
    try {
      const { data, error } = await supabase.functions.invoke<{ ok?: boolean; error?: string }>("reparse-document", {
        body: { proposalId: proposal.id, documentType: "rent_statement" },
      });
      if (error) throw error;
      if (!data?.ok) {
        toast.error(data?.error || "Re-parse failed");
        return;
      }
      await refresh();
      toast.success("Re-parsed — check the review queue for the fresh version");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Re-parse failed");
    } finally {
      setReparsing(false);
    }
  };

  return (
    <DocumentReviewCard proposal={proposal}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">Rent statement</Badge>
          {payload.tenantName && <span className="font-medium">{payload.tenantName}</span>}
          <span className="text-xs text-muted-foreground">
            {payload.periodStart || "—"} → {payload.periodEnd || "—"}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!propertyId && (
            <span className="text-xs text-destructive">
              No property matched{proposal.rawPropertyAddress ? ` — "${proposal.rawPropertyAddress}"` : ""}
            </span>
          )}
          {propertyId && <span className="text-xs text-muted-foreground">Property:</span>}
          <Select value={propertyId} onValueChange={setPropertyId}>
            <SelectTrigger className="h-7 w-[220px] text-xs">
              <SelectValue placeholder="Assign property" />
            </SelectTrigger>
            <SelectContent>
              {state.properties.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.alias || p.address}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <PropertyDialog
            property={null}
            onDone={() => {}}
            initialAddress={proposal.rawPropertyAddress}
            onCreated={(id) => setPropertyId(id)}
            trigger={
              <Button size="sm" variant="outline">
                Add new property
              </Button>
            }
          />
        </div>

        {!multiTenant && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Tenant:</span>
            <Select
              value={txTenantIds[0] ?? ""}
              onValueChange={(v) => {
                setTxTenantIds((ids) => ids.map(() => v));
                setExpTenantIds((ids) => ids.map(() => v));
              }}
            >
              <SelectTrigger className="h-7 w-[220px] text-xs">
                <SelectValue placeholder="Select tenant" />
              </SelectTrigger>
              <SelectContent>
                {tenantsAtProperty.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {unmatchedStatementTenantName && (
              <span className="text-xs text-destructive">No tenant found matching "{unmatchedStatementTenantName}"</span>
            )}
            {/* Always available, not just when a mismatch is auto-detected — the statement-level
                tenantName is often blank on statements the AI didn't extract a name for at all
                (not just changeover statements), so there's no name here to compare against even
                though the landlord can see with their own eyes that it's a different tenant. The
                single existing tenant still gets auto-selected as the likely default above; this
                is the manual override for when that guess is wrong. */}
            <TenantDialog
              propertyId={propertyId}
              initialValues={unmatchedStatementTenantName ? { name: unmatchedStatementTenantName } : undefined}
              onSaved={(id) => {
                setTxTenantIds((ids) => ids.map(() => id));
                setExpTenantIds((ids) => ids.map(() => id));
              }}
            >
              <Button size="sm" variant="outline" disabled={!propertyId}>
                Add as new tenant
              </Button>
            </TenantDialog>
          </div>
        )}

        {multiTenant && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">
              Multiple tenants at this property — assign each payment below (a changeover statement can include both an
              outgoing and incoming tenant).
            </span>
            <TenantDialog propertyId={propertyId}>
              <Button size="sm" variant="outline" disabled={!propertyId}>
                Add tenant
              </Button>
            </TenantDialog>
          </div>
        )}

        <div className="space-y-1 rounded border p-2">
          <div className="text-[11px] font-medium text-muted-foreground">Rent income → ledger</div>
          {txRows.map((tx, i) => (
            <div key={i} className="space-y-1 border-b pb-1 last:border-b-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={included[i]}
                  onChange={(e) => setIncluded((inc) => inc.map((v, j) => (j === i ? e.target.checked : v)))}
                />
                <Input
                  type="date"
                  value={tx.date}
                  onChange={(e) => updateTxRow(i, { date: e.target.value })}
                  className="h-6 w-[124px] shrink-0 text-xs"
                />
                <Input
                  type="number"
                  step="0.01"
                  value={tx.amount}
                  onChange={(e) => updateTxRow(i, { amount: Number(e.target.value) })}
                  className="h-6 w-20 shrink-0 text-xs"
                />
                <Input
                  value={tx.description}
                  onChange={(e) => updateTxRow(i, { description: e.target.value })}
                  className="h-6 min-w-[140px] flex-1 text-xs"
                />
                {!isRentTransaction(tx.description) && (
                  <span
                    className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                    title="Recharge/invoice, not rent — posted as a Water Invoice and excluded from the management fee's rent base"
                  >
                    not rent
                  </span>
                )}
                {multiTenant && (
                  <Select
                    value={txTenantIds[i]}
                    onValueChange={(v) => setTxTenantIds((ids) => ids.map((val, j) => (j === i ? v : val)))}
                  >
                    <SelectTrigger className="h-6 w-[140px] shrink-0 text-xs">
                      <SelectValue placeholder="Assign tenant" />
                    </SelectTrigger>
                    <SelectContent>
                      {tenantsAtProperty.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {multiTenant && !txTenantIds[i] && tx.tenantName && (
                  <TenantDialog
                    propertyId={propertyId}
                    initialValues={{ name: tx.tenantName }}
                    onSaved={(id) => setTxTenantIds((ids) => ids.map((val, j) => (j === i ? id : val)))}
                  >
                    <Button size="sm" variant="outline" className="h-6 shrink-0 text-xs" disabled={!propertyId}>
                      Add "{tx.tenantName}" as tenant
                    </Button>
                  </TenantDialog>
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 shrink-0"
                  title="This is actually a deduction, not income — move it to Deductions below"
                  onClick={() => moveTxToExpense(i)}
                >
                  <ArrowRight className="h-3 w-3" />
                </Button>
                <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" title="Remove this line" onClick={() => removeTxRow(i)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
              {ledgerDuplicates[i] && (
                <div className="ml-6 rounded border border-amber-300 bg-amber-50 p-1.5 text-xs text-amber-900">
                  Possible duplicate — {fmtCurrency(ledgerDuplicates[i]!.credit)} rent payment already on this
                  tenant's ledger dated {ledgerDuplicates[i]!.date}
                  {ledgerDuplicates[i]!.description ? ` ("${ledgerDuplicates[i]!.description}")` : ""}. Left
                  unchecked — tick the box above to add it anyway.
                </div>
              )}
            </div>
          ))}
          <Button size="sm" variant="outline" className="h-6 gap-1 text-xs" onClick={addTxRow}>
            <Plus className="h-3 w-3" /> Add income line
          </Button>
        </div>

        <div className="space-y-1 rounded border p-2">
          <div className="text-[11px] font-medium text-muted-foreground">
            Deductions on this statement → expenses
          </div>
          {expRows.map((e, i) => (
            <div key={i} className="space-y-1 border-b pb-1 last:border-b-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={expensesIncluded[i]}
                  onChange={(ev) => setExpensesIncluded((inc) => inc.map((v, j) => (j === i ? ev.target.checked : v)))}
                />
                <Input
                  type="date"
                  value={e.date}
                  onChange={(ev) => updateExpRow(i, { date: ev.target.value })}
                  className="h-6 w-[124px] shrink-0 text-xs"
                />
                <Input
                  type="number"
                  step="0.01"
                  value={e.amount}
                  onChange={(ev) => updateExpRow(i, { amount: Number(ev.target.value) })}
                  className="h-6 w-20 shrink-0 text-xs"
                />
                <Input
                  value={e.vendor}
                  onChange={(ev) => updateExpRow(i, { vendor: ev.target.value })}
                  placeholder="Paid to"
                  className="h-6 w-28 shrink-0 text-xs"
                />
                <Input
                  value={e.description}
                  onChange={(ev) => updateExpRow(i, { description: ev.target.value })}
                  placeholder="Description"
                  className="h-6 min-w-[120px] flex-1 text-xs"
                />
                {multiTenant && (
                  <Select
                    value={expTenantIds[i]}
                    onValueChange={(v) => setExpTenantIds((ids) => ids.map((val, j) => (j === i ? v : val)))}
                  >
                    <SelectTrigger className="h-6 w-[160px] shrink-0 text-xs">
                      <SelectValue placeholder="Shared" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SHARED_EXPENSE_TENANT}>Shared / whole property</SelectItem>
                      {tenantsAtProperty.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 shrink-0"
                  title="This is actually income, not a deduction — move it to Rent income above"
                  onClick={() => moveExpToIncome(i)}
                >
                  <ArrowRight className="h-3 w-3 -scale-x-100" />
                </Button>
                <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" title="Remove this line" onClick={() => removeExpRow(i)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
              <div className="ml-6 text-[10px] text-muted-foreground">
                Will post under: {categorizeAgentStatementLine(e, agent?.name)}
              </div>
              {(() => {
                const realTenantId = expTenantIds[i] && expTenantIds[i] !== SHARED_EXPENSE_TENANT ? expTenantIds[i] : undefined;
                const rechargeTenant = realTenantId ? tenantsAtProperty.find((t) => t.id === realTenantId) : undefined;
                const isWaterCharge = categorizeAgentStatementLine(e, agent?.name) === "Water Charges";
                return (
                  <div className="ml-6 space-y-0.5">
                    <label
                      className="flex items-center gap-1.5 text-[10px] text-muted-foreground"
                      title={
                        realTenantId
                          ? `Recharge ${fmtCurrency(e.amount)} to ${rechargeTenant?.name ?? "tenant"} — adds an invoice they'll owe`
                          : "Assign a specific tenant above first to recharge this line"
                      }
                    >
                      <input
                        type="checkbox"
                        disabled={!realTenantId}
                        checked={rechargeIncluded[i] && !!realTenantId}
                        onChange={(ev) => setRechargeIncluded((v) => v.map((val, j) => (j === i ? ev.target.checked : val)))}
                      />
                      <Receipt className="h-3 w-3 shrink-0" />
                      Recharge
                      {realTenantId && rechargeIncluded[i] && ` → ${rechargeTenant?.name ?? "tenant"}`}
                      {isWaterCharge && (
                        <button
                          type="button"
                          className="underline decoration-dotted underline-offset-2 hover:text-foreground"
                          onClick={(ev) => {
                            ev.preventDefault();
                            setWaterHintExpanded((v) => v.map((val, j) => (j === i ? !val : val)));
                          }}
                        >
                          Why only part of this?
                        </button>
                      )}
                    </label>
                    {isWaterCharge && waterHintExpanded[i] && (
                      <div className="text-[10px] text-amber-700">
                        This line is usually the FULL water bill (fixed service charges + usage) — only the usage
                        portion is the tenant's to pay. Edit the amount above down to just the usage component before
                        recharging, or leave unticked and recharge manually from the actual bill.
                      </div>
                    )}
                  </div>
                );
              })()}
              {billMatches[i] && (
                <label className="ml-6 flex items-center gap-2 rounded border border-amber-300 bg-amber-50 p-1.5 text-xs text-amber-900">
                  <input
                    type="checkbox"
                    checked={matchAsBill[i]}
                    onChange={(ev) => setMatchAsBill((m) => m.map((v, j) => (j === i ? ev.target.checked : v)))}
                  />
                  <span>
                    Looks like your existing {fmtCurrency(billMatches[i]!.amount)} {billMatches[i]!.billType} bill due{" "}
                    {billMatches[i]!.dueDate} — mark it paid instead of adding a new expense?
                    {Math.abs(billMatches[i]!.amount - e.amount) > 0.01 &&
                      ` (bill is ${fmtCurrency(billMatches[i]!.amount)}, statement says ${fmtCurrency(e.amount)})`}
                  </span>
                </label>
              )}
              {expenseDuplicates[i] && (
                <div className="ml-6 rounded border border-amber-300 bg-amber-50 p-1.5 text-xs text-amber-900">
                  Possible duplicate — {fmtCurrency(expenseDuplicates[i]!.amount)} {expenseDuplicates[i]!.kind} already
                  on file dated {expenseDuplicates[i]!.date}
                  {expenseDuplicates[i]!.label ? ` ("${expenseDuplicates[i]!.label}")` : ""}. Left unchecked — tick
                  the box above to add it anyway.
                </div>
              )}
            </div>
          ))}
          <Button size="sm" variant="outline" className="h-6 gap-1 text-xs" onClick={addExpRow}>
            <Plus className="h-3 w-3" /> Add deduction line
          </Button>
        </div>

        <div className="space-y-1 rounded border bg-muted/30 p-2 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <span>
              Net (income − deductions): <span className="font-medium">{fmtCurrency(computedNet)}</span>
            </span>
            {hasBalanceRollover && (
              <span className="text-muted-foreground">
                {payload.openingBalance !== undefined && <>+ brought forward {fmtCurrency(payload.openingBalance)} </>}
                {payload.closingBalance !== undefined && <>− carried forward {fmtCurrency(payload.closingBalance)} </>}
                = expected payout <span className="font-medium text-foreground">{fmtCurrency(reconciledNet)}</span>
              </span>
            )}
            {payload.netToOwner !== undefined && (
              <span
                className={
                  Math.abs(reconciledNet - payload.netToOwner) < 0.01 ? "text-emerald-600" : "text-destructive"
                }
              >
                Statement says {fmtCurrency(payload.netToOwner)}
                {Math.abs(reconciledNet - payload.netToOwner) < 0.01 ? " ✓ matches" : " — doesn't match, check inclusions"}
              </span>
            )}
          </div>
        </div>

        {feeChecks.length > 0 && (
          <div className="space-y-1 rounded border p-2">
            <div className="text-[11px] font-medium text-muted-foreground">
              Fee check — against {agent!.name}'s management agreement
            </div>
            {feeChecks.map((c) => (
              <FeeCheckRow key={c.type} result={c} />
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button size="sm" onClick={confirm}>
            Confirm &amp; Add Payments
          </Button>
          <Button size="sm" variant="outline" onClick={onDismiss}>
            Dismiss
          </Button>
          {proposal.sourceFileData && (
            <Button
              size="sm"
              variant="ghost"
              className="gap-1 text-muted-foreground"
              disabled={reparsing}
              onClick={reparse}
              title="Re-run the AI reader on the original file — useful if it missed or misread a line. Dismisses this version."
            >
              <RefreshCw className="h-3.5 w-3.5" /> {reparsing ? "Re-parsing…" : "Re-parse document"}
            </Button>
          )}
        </div>
    </DocumentReviewCard>
  );
}

/** Shared row renderer for one FeeCheckResult — used both inline during rent-statement review
 * and in the standalone verification report/EOFY summary, so the colour/wording never drifts. */
export function FeeCheckRow({ result }: { result: FeeCheckResult }) {
  const { type, expected, actual, variance, status, calculation } = result;
  const style =
    status === "overcharge"
      ? "border-destructive/40 bg-destructive/5 text-destructive"
      : status === "not_charged"
        ? "border-amber-300 bg-amber-50 text-amber-900"
        : status === "unspecified"
          ? "border-muted bg-muted/30 text-muted-foreground"
          : status === "undercharge"
            ? "border-sky-300 bg-sky-50 text-sky-900"
            : "border-emerald-300 bg-emerald-50 text-emerald-900";
  const message =
    status === "match"
      ? `${fmtCurrency(actual)} — matches the agreed ${fmtCurrency(expected ?? 0)}`
      : status === "overcharge"
        ? `${fmtCurrency(actual)} charged — ${fmtCurrency(variance ?? 0)} more than the agreed ${fmtCurrency(expected ?? 0)}`
        : status === "undercharge"
          ? `${fmtCurrency(actual)} charged — ${fmtCurrency(Math.abs(variance ?? 0))} less than the agreed ${fmtCurrency(expected ?? 0)}`
          : status === "not_charged"
            ? `Not itemised this time — expected around ${fmtCurrency(expected ?? 0)}`
            : `${fmtCurrency(actual)} charged — no agreed rate on file for this fee`;
  return (
    <div className={`rounded border px-2 py-1 text-xs ${style}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{type}</span>
        <span>{message}</span>
      </div>
      {/* Lets the landlord check the AI's own arithmetic against the agreement terms directly,
       * rather than just trusting the flagged variance — see FeeCheckResult.calculation. */}
      {calculation && <div className="mt-0.5 text-[10px] italic opacity-80">{calculation}</div>}
    </div>
  );
}

function DepreciationReportProposalCard({ proposal, onDismiss }: { proposal: AiIntakeProposal; onDismiss: () => void }) {
  const { state, addDepreciationItem, deleteDepreciationItem, markProposalApplied } = useStore();
  const payload = proposal.payload as DepreciationReportProposalPayload;
  const [propertyId, setPropertyId] = useState(proposal.propertyId ?? "");
  const [included, setIncluded] = useState<boolean[]>(() => payload.items.map(() => true));
  const [replaceExisting, setReplaceExisting] = useState(true);

  const assetId = state.properties.find((p) => p.id === propertyId)?.assetId;
  // A depreciation report is normally a one-off document per property (unlike a bill, which
  // legitimately recurs) — a second upload from the same surveyor with the same reference/date
  // is treated as the identical document re-uploaded by mistake. See findDuplicateDepreciationReport's
  // doc comment for why a differently-dated report is deliberately NOT flagged here.
  const dup = assetId
    ? findDuplicateDepreciationReport(state.depreciationItems, {
        assetId,
        quantitySurveyor: payload.quantitySurveyor,
        reportReference: payload.reportReference,
        reportDate: payload.reportDate,
      })
    : null;

  const confirm = () => {
    if (!assetId) return toast.error("Select a property first");
    if (dup && replaceExisting) {
      state.depreciationItems.filter((it) => it.reportId === dup.reportId).forEach((it) => deleteDepreciationItem(it.id));
    }
    // Reuse the existing report's id when replacing, so the report stays one continuous record
    // instead of leaving a dangling old reportId with nothing in it.
    const reportId = dup && replaceExisting ? dup.reportId : uid("dr");
    let count = 0;
    payload.items.forEach((it, i) => {
      if (!included[i]) return;
      addDepreciationItem({
        assetId,
        description: it.description,
        purchaseCost: it.cost,
        effectiveLifeYears: it.lifeYears || 1,
        purchaseDate: payload.effectiveFrom || undefined,
        // Div 43 (capital works) is only ever claimable straight-line under ATO rules — same lock
        // applied everywhere else a division/method pair gets set (AddDepreciationReportDialog,
        // NewDepreciationItemDialog).
        method: it.division === "Div 43" ? "Prime Cost" : "Diminishing Value",
        division: it.division,
        // The report's own printed per-year figures, when Gemini found a year-by-year table for
        // this item — the permanent record from here on, not re-derived from cost/life/method on
        // every read (see the annualClaims field doc on DepreciationItem).
        annualClaims: it.annualClaims,
        reportId,
        quantitySurveyor: payload.quantitySurveyor || undefined,
        reportReference: payload.reportReference || undefined,
        reportDate: payload.reportDate || undefined,
        effectiveFrom: payload.effectiveFrom || undefined,
        sourceFileName: proposal.sourceFileName,
        sourceFileData: proposal.sourceFileData,
      });
      count++;
    });
    if (count === 0) return toast.error("Select at least one item to add");
    markProposalApplied(proposal.id, { propertyId });
    toast.success(dup && replaceExisting ? `Replaced existing report with ${count} item(s)` : `Added ${count} depreciation item(s) from report`);
  };

  return (
    <DocumentReviewCard proposal={proposal}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">Depreciation report</Badge>
          {payload.quantitySurveyor && <span className="font-medium">{payload.quantitySurveyor}</span>}
          {payload.reportDate && <span className="text-xs text-muted-foreground">{payload.reportDate}</span>}
        </div>

        {!proposal.propertyId && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-destructive">
              No property matched{proposal.rawPropertyAddress ? ` — "${proposal.rawPropertyAddress}"` : ""}
            </span>
            <Select value={propertyId} onValueChange={setPropertyId}>
              <SelectTrigger className="h-7 w-[220px] text-xs">
                <SelectValue placeholder="Assign property" />
              </SelectTrigger>
              <SelectContent>
                {state.properties.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.alias || p.address}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {dup && (
          <div className="space-y-1.5 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
            <div>
              A report from {dup.quantitySurveyor} dated {dup.reportDate || "—"} already exists for this property (
              {dup.itemCount} item{dup.itemCount === 1 ? "" : "s"}, {fmtCurrency(dup.totalCost)}) — this looks like the
              same document.
            </div>
            <label className="flex items-center gap-2">
              <input type="radio" checked={replaceExisting} onChange={() => setReplaceExisting(true)} />
              <span>Replace existing report (recommended)</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={!replaceExisting} onChange={() => setReplaceExisting(false)} />
              <span>Add as a separate report</span>
            </label>
          </div>
        )}

        <div className="space-y-1 rounded border p-2">
          <div className="text-[11px] font-medium text-muted-foreground">Depreciating assets</div>
          {payload.items.map((it, i) => (
            <label key={i} className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={included[i]}
                onChange={(e) => setIncluded((inc) => inc.map((v, j) => (j === i ? e.target.checked : v)))}
              />
              <span className="flex-1 truncate">{it.description}</span>
              <Badge variant="outline" className="text-[10px]">{it.division}</Badge>
              <span className="w-20 shrink-0 text-right font-medium">{fmtCurrency(it.cost)}</span>
              <span className="w-14 shrink-0 text-right text-muted-foreground">{it.lifeYears ? `${it.lifeYears}y` : "—"}</span>
            </label>
          ))}
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" disabled={!propertyId} onClick={confirm}>
            {dup && replaceExisting ? "Replace existing report" : "Add selected items"}
          </Button>
          <Button size="sm" variant="outline" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
    </DocumentReviewCard>
  );
}

/**
 * A document Gemini couldn't classify into any known type — no extraction was attempted, so
 * there's nothing to review field-by-field. Assigning a property (optional) and filing it just
 * marks it applied so it's easy to find later in Documents; the source document itself is already
 * safe (attached to this proposal row) either way.
 */
/** Every DocumentType the pipeline has a dedicated parser for (router.ts) except "other" itself —
 * offered as "tell it what this actually is" choices on an unclassified document. */
const REPARSE_DOCUMENT_TYPES: { value: string; label: string }[] = [
  { value: "bill", label: "Bill" },
  { value: "lease_agreement", label: "Lease Agreement" },
  { value: "rent_statement", label: "Rent Statement" },
  { value: "property_document", label: "Property Document" },
  { value: "depreciation_report", label: "Depreciation Report" },
  { value: "loan_document", label: "Loan Document" },
  { value: "loan_statement", label: "Loan Statement" },
  { value: "bank_statement", label: "Bank Statement" },
  { value: "property_sale", label: "Property Sale" },
];

function UnclassifiedProposalCard({ proposal, onDismiss }: { proposal: AiIntakeProposal; onDismiss: () => void }) {
  const { state, updateProposal, refresh } = useStore();
  const payload = proposal.payload as UnclassifiedProposalPayload;
  const [propertyId, setPropertyId] = useState(proposal.propertyId ?? "");
  const [reclassifyAs, setReclassifyAs] = useState("");
  const [reparsing, setReparsing] = useState(false);

  const file = () => {
    updateProposal(proposal.id, { propertyId: propertyId || undefined, status: "applied" });
    toast.success("Filed in Documents");
  };

  // Re-runs extraction with the type-specific parser the landlord picked (the exact same
  // DB-writing parsers the email/upload pipeline dispatches to, see router.ts) instead of relying
  // on Gemini's own classification guess. Deletes this unclassified row once the replacement is
  // confirmed written — see reparse-document/index.ts.
  const reparse = async () => {
    if (!reclassifyAs) return toast.error("Choose what kind of document this is first");
    setReparsing(true);
    try {
      const { data, error } = await supabase.functions.invoke<{ ok?: boolean; error?: string }>("reparse-document", {
        body: { proposalId: proposal.id, documentType: reclassifyAs },
      });
      if (error) throw error;
      if (!data?.ok) {
        toast.error(data?.error || "Couldn't read this document as that type");
        return;
      }
      await refresh();
      toast.success(
        `Re-parsed as ${REPARSE_DOCUMENT_TYPES.find((t) => t.value === reclassifyAs)?.label ?? reclassifyAs} — check the review queue`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Re-parse failed");
    } finally {
      setReparsing(false);
    }
  };

  return (
    <DocumentReviewCard proposal={proposal}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">Unrecognised document</Badge>
          <span className="font-medium">{payload.documentCategory}</span>
        </div>
        <div className="text-xs text-muted-foreground">
          Couldn't tell what kind of document this is, so nothing was extracted — the file itself is safe. Tell it
          what this actually is to try extraction again, assign a property and file it as-is, or dismiss it.
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded border p-2">
          <span className="text-xs text-muted-foreground">This is actually a:</span>
          <Select value={reclassifyAs} onValueChange={setReclassifyAs}>
            <SelectTrigger className="h-7 w-[200px] text-xs">
              <SelectValue placeholder="Choose document type" />
            </SelectTrigger>
            <SelectContent>
              {REPARSE_DOCUMENT_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={reparse} disabled={!reclassifyAs || reparsing}>
            {reparsing ? "Reading…" : "Re-parse"}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Property:</span>
          <Select value={propertyId} onValueChange={setPropertyId}>
            <SelectTrigger className="h-7 w-[220px] text-xs">
              <SelectValue placeholder="No property (optional)" />
            </SelectTrigger>
            <SelectContent>
              {state.properties.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.alias || p.address}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" onClick={file}>
            File in Documents
          </Button>
          <Button size="sm" variant="outline" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
    </DocumentReviewCard>
  );
}

function PropertyPicker({ propertyId, onChange }: { propertyId: string; onChange: (id: string) => void }) {
  const { state } = useStore();
  return (
    <Select value={propertyId} onValueChange={onChange}>
      <SelectTrigger className="h-7 w-[220px] text-xs">
        <SelectValue placeholder="Assign property" />
      </SelectTrigger>
      <SelectContent>
        {state.properties.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.alias || p.address}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function LoanDocumentProposalCard({ proposal, onDismiss }: { proposal: AiIntakeProposal; onDismiss: () => void }) {
  const { state, addLoan, markProposalApplied } = useStore();
  const payload = proposal.payload as LoanDocumentProposalPayload;
  const [propertyId, setPropertyId] = useState(proposal.propertyId ?? "");

  const confirm = () => {
    const property = state.properties.find((p) => p.id === propertyId);
    if (!property) return toast.error("Select a property first");
    addLoan({
      propertyId,
      assetId: property.assetId,
      bankName: payload.lenderName,
      totalBalance: payload.loanAmount ?? 0,
      originalAmount: payload.loanAmount,
      interestRate: payload.interestRate ?? 0,
      monthlyEmi: payload.monthlyRepayment ?? 0,
      startDate: payload.startDate,
      maturityDate: payload.maturityDate,
      nextRepaymentDate: payload.nextRepaymentDate,
      // Drives the month-on-month "EMI due soon" Dashboard forecast, which only reads
      // dueDayOfMonth — derive it from the extracted next repayment date.
      dueDayOfMonth: payload.nextRepaymentDate ? new Date(payload.nextRepaymentDate).getDate() : undefined,
      productType: payload.productType,
      bsb: payload.bsb,
      accountNumber: payload.accountNumber,
      hasOffsetAccount: payload.hasOffsetAccount,
      status: "Active",
    });
    markProposalApplied(proposal.id, { propertyId });
    toast.success("Loan created");
  };

  return (
    <DocumentReviewCard proposal={proposal}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">New loan</Badge>
          <span className="font-medium">{payload.lenderName}</span>
        </div>

        {!proposal.propertyId && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-destructive">
              No property matched{proposal.rawPropertyAddress ? ` — "${proposal.rawPropertyAddress}"` : ""}
            </span>
            <PropertyPicker propertyId={propertyId} onChange={setPropertyId} />
          </div>
        )}

        <div className="grid grid-cols-2 gap-1 rounded border p-2 text-xs sm:grid-cols-3">
          <div>
            <div className="text-muted-foreground">Loan amount</div>
            <div className="font-medium">{payload.loanAmount ? fmtCurrency(payload.loanAmount) : "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Interest rate</div>
            <div className="font-medium">{payload.interestRate ? `${payload.interestRate}%` : "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Monthly repayment</div>
            <div className="font-medium">{payload.monthlyRepayment ? fmtCurrency(payload.monthlyRepayment) : "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Start date</div>
            <div className="font-medium">{payload.startDate || "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Maturity date</div>
            <div className="font-medium">{payload.maturityDate || "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Product type</div>
            <div className="font-medium">{payload.productType || "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">BSB / account</div>
            <div className="font-medium">{payload.bsb || payload.accountNumber ? `${payload.bsb ?? "—"} / ${payload.accountNumber ?? "—"}` : "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Offset account</div>
            <div className="font-medium">{payload.hasOffsetAccount === undefined ? "—" : payload.hasOffsetAccount ? "Yes" : "No"}</div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" disabled={!propertyId} onClick={confirm}>
            Create loan
          </Button>
          <Button size="sm" variant="outline" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
    </DocumentReviewCard>
  );
}

function LoanStatementProposalCard({ proposal, onDismiss }: { proposal: AiIntakeProposal; onDismiss: () => void }) {
  const { state, addLoan, updateLoan, updateProposal, addExpense, addLoanStatement, findOrCreateProvider, markProposalApplied } = useStore();
  const payload = proposal.payload as LoanStatementProposalPayload;
  const [propertyId, setPropertyId] = useState(proposal.propertyId ?? "");
  const [loanId, setLoanId] = useState(proposal.matchedLoanId ?? "");
  // Offered whenever there's no existing loan to pick for this property — the statement's own
  // extracted figures (lender name, EMI, closing balance, account last-4) prefill the new Loan
  // so confirming this card can also be the first time the loan itself gets created, instead of
  // requiring a separate trip to "Add Loan" first with no data carried over.
  const [creatingLoan, setCreatingLoan] = useState(false);
  const [newLoanInterestRate, setNewLoanInterestRate] = useState("");

  // Older proposals (staged before line-item extraction existed) only ever had the aggregate
  // fields — fall back to a single line dated at period end so this card still works for them.
  const initialLines: LoanStatementLineItem[] =
    payload.lineItems && payload.lineItems.length > 0
      ? payload.lineItems
      : payload.interestCharged !== undefined || payload.principalPaid !== undefined
        ? [
            {
              date: payload.periodEnd || payload.periodStart || todayISO(),
              interestCharged: payload.interestCharged,
              principalPaid: payload.principalPaid,
              repaymentAmount: payload.repaymentsMade,
              balanceAfter: payload.closingBalance,
            },
          ]
        : [];

  const [lines, setLines] = useState<LoanStatementLineItem[]>(initialLines);
  // Principal/Balance after are only worth showing once something on the statement actually
  // reported them — an interest-only loan's statement never will, and an empty "—" input on every
  // line for a field that's never populated is just clutter. Card-level (not per-line) so every
  // row stays visually consistent; the landlord can still reveal either field manually to type a
  // value in on one specific line.
  const [revealedPrincipal, setRevealedPrincipal] = useState(() => initialLines.some((li) => li.principalPaid !== undefined));
  const [revealedBalance, setRevealedBalance] = useState(() => initialLines.some((li) => li.balanceAfter !== undefined));
  const loansForProperty = propertyId ? state.loans.filter((l) => l.propertyId === propertyId) : [];
  const loan = state.loans.find((l) => l.id === loanId);

  // Each line's interest is what actually gets posted as a deductible Expense (dated to that
  // line, not lumped into one figure) — check each one against existing bills/expenses the same
  // way Add Bill/Add Transaction do, so re-approving the same statement twice (or two statements
  // with overlapping periods) is caught instead of silently doubling up the interest deduction.
  const duplicates = lines.map((li) =>
    li.interestCharged
      ? findDuplicateRecord(state.bills, state.expenses, {
          propertyId: propertyId || undefined,
          vendorOrDescription: `${payload.lenderName} — loan interest`,
          amount: li.interestCharged,
          date: li.date,
        })
      : null,
  );
  // Separate from the interest-expense check above: a period-only line (no interest extracted, or
  // this loan is principal/fee-only) never trips `duplicates`, so a proposal re-applied after the
  // card failed to disappear (e.g. a dropped markProposalApplied write) would otherwise insert a
  // second loan_statements row for the same period with no warning at all.
  const alreadyApplied = lines.map((li) => state.loanStatements.some((ls) => ls.loanId === loanId && ls.periodStart === li.date && ls.periodEnd === li.date));
  const [included, setIncluded] = useState<boolean[]>(() => duplicates.map((d, i) => !d && !alreadyApplied[i]));

  const updateLine = (i: number, patch: Partial<LoanStatementLineItem>) =>
    setLines((ls) => ls.map((li, j) => (j === i ? { ...li, ...patch } : li)));
  const removeLine = (i: number) => {
    setLines((ls) => ls.filter((_, j) => j !== i));
    setIncluded((inc) => inc.filter((_, j) => j !== i));
  };

  const createLoan = () => {
    if (!propertyId) return toast.error("Select the property first");
    const rate = parseFloat(newLoanInterestRate);
    if (!rate || rate <= 0) return toast.error("Enter the loan's interest rate to create it");
    // The property's matchedLoanId may have failed to resolve (lender-name text variance between
    // statements) even though a loan for this same account already exists — catching that here by
    // account number stops a second, duplicate Loan record from being created for what is really
    // one real-world loan.
    const existingByAccount = payload.accountNumberLast4
      ? loansForProperty.find((l) => l.accountNumber && l.accountNumber === payload.accountNumberLast4)
      : undefined;
    if (existingByAccount) {
      toast.error(`A ${existingByAccount.bankName} loan ending ${existingByAccount.accountNumber} already exists for this property — select it above instead of creating a new one.`);
      setLoanId(existingByAccount.id);
      setCreatingLoan(false);
      return;
    }
    const newLoanId = addLoan({
      propertyId,
      bankName: payload.lenderName,
      accountNumber: payload.accountNumberLast4,
      totalBalance: payload.closingBalance ?? 0,
      interestRate: rate,
      monthlyEmi: payload.emiAmountDue ?? 0,
      nextRepaymentDate: payload.nextEmiDueDate,
      dueDayOfMonth: payload.nextEmiDueDate ? new Date(payload.nextEmiDueDate).getDate() : undefined,
      status: "Active",
    });
    updateProposal(proposal.id, { matchedLoanId: newLoanId });
    setLoanId(newLoanId);
    setCreatingLoan(false);
    toast.success(`${payload.lenderName} loan created`);
  };

  const confirm = () => {
    if (!loanId) return toast.error("Select which loan this statement is for");
    const selected = lines.filter((_, i) => included[i]);
    if (selected.length === 0) return toast.error("Select at least one line to apply");

    // The lender is a real payee — file it in the Provider directory (matching an existing bank
    // by name rather than creating a duplicate) the same way a bill's vendor always is, so the
    // interest expense below carries a proper providerName/providerId instead of going blank.
    const lenderProviderId = payload.lenderName ? findOrCreateProvider(payload.lenderName, propertyId || undefined, "Interest on Loan") : undefined;

    selected.forEach((li) => {
      // Only the interest portion is a deductible expense / cashflow-affecting transaction.
      // Principal never posts here — it only reduces the loan balance below.
      const expenseId = li.interestCharged
        ? addExpense({
            itemName: `${payload.lenderName} — loan interest`,
            cost: li.interestCharged,
            date: li.date,
            propertyId,
            assetId: loan?.assetId,
            category: "Interest on Loan",
            taxCategory: expenseCategoryToTaxCategory("Interest on Loan"),
            providerName: payload.lenderName,
            providerId: lenderProviderId,
            hasWarranty: false,
            rechargeToTenant: false,
            status: "approved",
            source: "upload",
            sourceFileName: proposal.sourceFileName,
            sourceFileData: proposal.sourceFileData,
          })
        : undefined;

      addLoanStatement({
        loanId,
        propertyId,
        periodStart: li.date,
        periodEnd: li.date,
        interestCharged: li.interestCharged,
        principalPaid: li.principalPaid,
        repaymentsMade: li.repaymentAmount,
        closingBalance: li.balanceAfter,
        sourceFileName: proposal.sourceFileName,
        sourceFileData: proposal.sourceFileData,
        proposalId: proposal.id,
        expenseId,
      });
    });

    // Every field below is behind its own presence check — a statement missing emi/due-date/
    // account-last-4 must never overwrite manually-entered data with a blank (updateRow's
    // stripUndefined in lib/db.ts drops undefined keys too, as a second safety net).
    const patch: Record<string, unknown> = {};
    // Principal reduces the running balance — prefer the last applied line's own stated balance
    // (most authoritative, straight off the statement); fall back to subtracting the total
    // principal paid across applied lines from the loan's current balance.
    const lastBalance = selected.at(-1)?.balanceAfter;
    const totalPrincipal = selected.reduce((s, li) => s + (li.principalPaid ?? 0), 0);
    if (lastBalance !== undefined) patch.totalBalance = lastBalance;
    else if (totalPrincipal > 0 && loan) patch.totalBalance = Math.max(0, loan.totalBalance - totalPrincipal);
    else if (payload.closingBalance !== undefined) patch.totalBalance = payload.closingBalance;
    // The monthly repayment amount doesn't post as its own transaction — it feeds Loan.monthlyEmi,
    // which is what the Forecasts tab's cashflow projection reads (src/routes/forecasts.tsx).
    if (payload.emiAmountDue !== undefined) patch.monthlyEmi = payload.emiAmountDue;
    if (payload.nextEmiDueDate) {
      patch.nextRepaymentDate = payload.nextEmiDueDate;
      patch.dueDayOfMonth = new Date(payload.nextEmiDueDate).getDate();
    }
    if (payload.accountNumberLast4) patch.accountNumber = payload.accountNumberLast4;
    // updateLoan snapshots totalBalance into loanBalanceSnapshots whenever the patch includes it
    // (see store.tsx) — applying a statement will therefore also produce a balance-snapshot row
    // alongside the loan_statements row(s) added above. That's intentional overlap, not a bug: the
    // snapshot feeds the portfolio-wide Dashboard trend (every balance-changing edit, manual or
    // statement-driven), while loan_statements is this specific loan's interest/principal history.
    if (Object.keys(patch).length > 0) updateLoan(loanId, patch as Partial<Loan>);

    markProposalApplied(proposal.id, { propertyId });
    toast.success(`Loan statement applied — ${selected.length} period(s)`);
  };

  return (
    <DocumentReviewCard proposal={proposal}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">Loan statement</Badge>
          <span className="font-medium">{payload.lenderName}</span>
          <span className="text-xs text-muted-foreground">
            {payload.periodStart || "—"} → {payload.periodEnd || "—"}
          </span>
        </div>

        {!proposal.propertyId && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-destructive">No property matched:</span>
            <PropertyPicker propertyId={propertyId} onChange={setPropertyId} />
          </div>
        )}

        {propertyId && !creatingLoan && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Loan:</span>
            <Select value={loanId} onValueChange={setLoanId}>
              <SelectTrigger className="h-7 w-[220px] text-xs">
                <SelectValue placeholder="Select loan" />
              </SelectTrigger>
              <SelectContent>
                {loansForProperty.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.bankName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={() => setCreatingLoan(true)}>
              <Plus className="h-3 w-3" /> New loan
            </Button>
          </div>
        )}

        {propertyId && creatingLoan && (
          <div className="space-y-2 rounded border border-dashed p-2">
            <div className="text-[11px] font-medium text-muted-foreground">
              No loan on file for {payload.lenderName} yet — create one from this statement's own figures.
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <div>
                <div className="text-muted-foreground">Lender</div>
                <div className="font-medium">{payload.lenderName}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Current balance</div>
                <div className="font-medium">{payload.closingBalance ? fmtCurrency(payload.closingBalance) : "—"}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Repayment</div>
                <div className="font-medium">{payload.emiAmountDue ? fmtCurrency(payload.emiAmountDue) : "—"}</div>
              </div>
              <Field label="Interest rate (%)">
                <Input
                  type="number"
                  step="0.01"
                  value={newLoanInterestRate}
                  onChange={(e) => setNewLoanInterestRate(e.target.value)}
                  className="h-7 text-xs"
                  placeholder="not on the statement"
                />
              </Field>
            </div>
            <div className="flex gap-2">
              <Button size="sm" className="h-7 text-xs" onClick={createLoan}>
                Create loan
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setCreatingLoan(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-1 rounded border p-2 text-xs sm:grid-cols-3">
          <div>
            <div className="text-muted-foreground">EMI due</div>
            <div className="font-medium">{payload.emiAmountDue ? fmtCurrency(payload.emiAmountDue) : "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Next due date</div>
            <div className="font-medium">{payload.nextEmiDueDate || "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Statement closing balance</div>
            <div className="font-medium">{payload.closingBalance ? fmtCurrency(payload.closingBalance) : "—"}</div>
          </div>
        </div>

        <div className="space-y-1 rounded border p-2">
          <div className="text-[11px] font-medium text-muted-foreground">
            Interest is logged as a deductible expense on its own date below; principal only reduces the loan
            balance — tick which periods to apply.
          </div>
          {lines.map((li, i) => (
            <div key={i} className="space-y-1 border-b pb-1.5 last:border-b-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={included[i]}
                  onChange={(e) => setIncluded((inc) => inc.map((v, j) => (j === i ? e.target.checked : v)))}
                />
                <Input
                  type="date"
                  value={li.date}
                  onChange={(e) => updateLine(i, { date: e.target.value })}
                  className="h-7 w-[130px] text-xs"
                />
                <span className="text-muted-foreground">Interest</span>
                <Input
                  type="number"
                  step="0.01"
                  value={li.interestCharged ?? ""}
                  onChange={(e) => updateLine(i, { interestCharged: e.target.value === "" ? undefined : Number(e.target.value) })}
                  className="h-7 w-[90px] text-xs"
                  placeholder="—"
                />
                {revealedPrincipal ? (
                  <>
                    <span className="text-muted-foreground">Principal</span>
                    <Input
                      type="number"
                      step="0.01"
                      value={li.principalPaid ?? ""}
                      onChange={(e) => updateLine(i, { principalPaid: e.target.value === "" ? undefined : Number(e.target.value) })}
                      className="h-7 w-[90px] text-xs"
                      placeholder="—"
                    />
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 px-2 text-xs text-muted-foreground"
                    onClick={() => setRevealedPrincipal(true)}
                  >
                    <Plus className="h-3 w-3" /> Principal
                  </Button>
                )}
                {revealedBalance ? (
                  <>
                    <span className="text-muted-foreground">Balance after</span>
                    <Input
                      type="number"
                      step="0.01"
                      value={li.balanceAfter ?? ""}
                      onChange={(e) => updateLine(i, { balanceAfter: e.target.value === "" ? undefined : Number(e.target.value) })}
                      className="h-7 w-[100px] text-xs"
                      placeholder="—"
                    />
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 px-2 text-xs text-muted-foreground"
                    onClick={() => setRevealedBalance(true)}
                  >
                    <Plus className="h-3 w-3" /> Balance after
                  </Button>
                )}
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => removeLine(i)} title="Remove this line">
                  <span aria-hidden>✕</span>
                </Button>
              </div>
              {alreadyApplied[i] && (
                <div className="ml-6 flex items-start gap-2 rounded border border-amber-300 bg-amber-50 p-1.5 text-xs text-amber-900">
                  <span>
                    This loan already has a statement period recorded for {li.date} — left unchecked to avoid a duplicate
                    entry. Tick the box above to apply anyway.
                  </span>
                </div>
              )}
              {duplicates[i] && (
                <div className="ml-6 flex items-start gap-2 rounded border border-amber-300 bg-amber-50 p-1.5 text-xs text-amber-900">
                  <span>
                    Looks like a matching {fmtCurrency(duplicates[i]!.amount)} expense already exists on {duplicates[i]!.date}
                    {duplicates[i]!.status ? ` (${duplicates[i]!.status})` : ""} — left unchecked to avoid logging interest twice.
                    Tick the box above to apply anyway.
                  </span>
                </div>
              )}
            </div>
          ))}
          {lines.length === 0 && <div className="text-xs text-muted-foreground">No interest/repayment lines extracted.</div>}
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" disabled={!loanId || lines.length === 0} onClick={confirm}>
            Apply to loan
          </Button>
          <Button size="sm" variant="outline" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
    </DocumentReviewCard>
  );
}

function BankStatementProposalCard({ proposal, onDismiss }: { proposal: AiIntakeProposal; onDismiss: () => void }) {
  const { state, addExpense, addBankAccount, updateProposal, markBillPaid, markProposalApplied } = useStore();
  const payload = proposal.payload as BankStatementProposalPayload;
  const [propertyId, setPropertyId] = useState(proposal.propertyId ?? "");
  const [bankAccountId, setBankAccountId] = useState(proposal.bankAccountId ?? "");
  // Offered whenever this statement isn't already linked to a BankAccount — the statement's own
  // extracted institution/account details prefill the new account, so this card can also be the
  // first time that account gets added, matching what LoanStatementProposalCard already does.
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [newAccountEntityId, setNewAccountEntityId] = useState(state.entities[0]?.id ?? "");
  const [included, setIncluded] = useState<boolean[]>(() => payload.transactions.map(() => false));
  // Only an "out" (debit) line can be paying an existing bill — "in" is income. Suggests
  // marking that bill paid instead of importing the line as a second, disconnected Expense.
  const billMatches = payload.transactions.map((tx) =>
    tx.direction === "out"
      ? findMatchingUnpaidBill(state.bills, {
          propertyId: propertyId || undefined,
          vendorOrDescription: tx.description,
          amount: tx.amount,
          date: tx.date,
        })
      : null,
  );
  const [matchAsBill, setMatchAsBill] = useState<boolean[]>(() => billMatches.map((m) => !!m));
  // Defaults to the matched provider's own default category (same as everywhere else a
  // providerId is resolved) so a recognised vendor doesn't need re-categorizing every time;
  // otherwise a generic catch-all per direction, always overridable before importing.
  const [categories, setCategories] = useState<string[]>(() =>
    payload.transactions.map((tx) => {
      const provider = tx.providerId ? state.providers.find((p) => p.id === tx.providerId) : undefined;
      return provider?.defaultCategory ?? (tx.direction === "in" ? "Other Rental Income" : "Sundry Rental Expenses");
    }),
  );
  // Same duplicate check Add Bill/Add Transaction run before saving — a debit line that already
  // matches a posted Expense/Bill is flagged so re-importing the same bank statement (or one
  // covering an overlapping period) doesn't silently double up the transaction.
  const duplicateMatches = payload.transactions.map((tx) =>
    tx.direction === "out"
      ? findDuplicateRecord(state.bills, state.expenses, {
          propertyId: propertyId || undefined,
          vendorOrDescription: tx.description,
          amount: tx.amount,
          date: tx.date,
        })
      : null,
  );

  const createAccount = () => {
    if (!newAccountEntityId) return toast.error("Add an entity first (Entities page) before adding a bank account");
    const newId = addBankAccount({
      entityId: newAccountEntityId,
      institution: payload.bankName,
      accountName: payload.accountName || payload.bankName || "Bank account",
      accountType: "Transaction",
      bsb: payload.bsb,
      accountNumber: payload.accountNumber,
      currentBalance: 0,
    });
    updateProposal(proposal.id, { bankAccountId: newId });
    setBankAccountId(newId);
    setCreatingAccount(false);
    toast.success("Bank account created");
  };

  const confirm = () => {
    if (!propertyId) return toast.error("Select a property first");
    let count = 0;
    payload.transactions.forEach((tx, i) => {
      if (!included[i]) return;
      const match = billMatches[i];
      if (match && matchAsBill[i]) {
        markBillPaid(match.id, { paidDate: tx.date });
        count++;
        return;
      }
      addExpense({
        itemName: tx.description,
        cost: tx.amount,
        date: tx.date,
        propertyId,
        direction: tx.direction === "in" ? "Income" : undefined,
        // taxCategory is meaningless for an Income row (see Expense.taxCategory) — only a
        // genuine "out" line's chosen category decides Immediate Deduction vs Capital Works.
        category: categories[i] as ExpenseCategory,
        taxCategory: tx.direction === "out" ? expenseCategoryToTaxCategory(categories[i]) : "Immediate Deduction",
        providerId: tx.providerId,
        providerName: tx.suggestedProviderName,
        hasWarranty: false,
        rechargeToTenant: false,
        status: "approved",
        source: "upload",
        sourceFileName: proposal.sourceFileName,
        sourceFileData: proposal.sourceFileData,
        feedProposalId: proposal.id,
        feedLineIndex: i,
      });
      count++;
    });
    if (count === 0) return toast.error("Select at least one transaction to import");
    markProposalApplied(proposal.id, { propertyId, ...(bankAccountId ? { bankAccountId } : {}) });
    toast.success(`Imported ${count} transaction(s)`);
  };

  return (
    <DocumentReviewCard proposal={proposal}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">Bank statement</Badge>
          {payload.bankName && <span className="font-medium">{payload.bankName}</span>}
          <span className="text-xs text-muted-foreground">
            {payload.periodStart || "—"} → {payload.periodEnd || "—"}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Apply selected lines to:</span>
          <PropertyPicker propertyId={propertyId} onChange={setPropertyId} />
        </div>

        {!bankAccountId && !creatingAccount && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">Not linked to a bank account on file yet.</span>
            <Button size="sm" variant="ghost" className="h-6 gap-1 px-2 text-xs" onClick={() => setCreatingAccount(true)}>
              <Plus className="h-3 w-3" /> Add as new bank account
            </Button>
          </div>
        )}
        {bankAccountId && <div className="text-xs text-muted-foreground">Linked to {state.bankAccounts.find((a) => a.id === bankAccountId)?.accountName ?? "a bank account"}.</div>}

        {creatingAccount && (
          <div className="space-y-2 rounded border border-dashed p-2">
            <div className="text-[11px] font-medium text-muted-foreground">Create a bank account from this statement's own details.</div>
            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <div>
                <div className="text-muted-foreground">Institution</div>
                <div className="font-medium">{payload.bankName || "—"}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Account name</div>
                <div className="font-medium">{payload.accountName || payload.bankName || "—"}</div>
              </div>
              <div>
                <div className="text-muted-foreground">BSB / account</div>
                <div className="font-medium">{payload.bsb || payload.accountNumber ? `${payload.bsb ?? "—"} / ${payload.accountNumber ?? "—"}` : "—"}</div>
              </div>
              <Field label="Owning entity">
                <Select value={newAccountEntityId} onValueChange={setNewAccountEntityId}>
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue placeholder="Select entity" />
                  </SelectTrigger>
                  <SelectContent>
                    {state.entities.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <div className="flex gap-2">
              <Button size="sm" className="h-7 text-xs" onClick={createAccount}>
                Create bank account
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setCreatingAccount(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        <div className="max-h-64 space-y-1 overflow-y-auto rounded border p-2">
          <div className="text-[11px] font-medium text-muted-foreground">
            Transactions — tick the ones relevant to this property
          </div>
          {payload.transactions.map((tx, i) => (
            <div key={i} className="space-y-1 border-b pb-1 last:border-b-0 last:pb-0">
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={included[i]}
                  onChange={(e) => setIncluded((inc) => inc.map((v, j) => (j === i ? e.target.checked : v)))}
                />
                <span className="w-24 shrink-0">{tx.date}</span>
                <span className={"w-20 shrink-0 text-right font-medium " + (tx.direction === "in" ? "text-emerald-600" : "")}>
                  {tx.direction === "in" ? "+" : "−"}
                  {fmtCurrency(tx.amount)}
                </span>
                <span className="flex-1 truncate text-muted-foreground">{tx.description}</span>
              </label>
              {!(billMatches[i] && matchAsBill[i]) && (
                <div className="ml-6 flex items-center gap-1.5">
                  <span className="text-[11px] text-muted-foreground">Category:</span>
                  <Select value={categories[i]} onValueChange={(v) => setCategories((c) => c.map((x, j) => (j === i ? v : x)))}>
                    <SelectTrigger className="h-6 w-[190px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(tx.direction === "in" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES).map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {billMatches[i] && (
                <label className="ml-6 flex items-center gap-2 rounded border border-amber-300 bg-amber-50 p-1.5 text-xs text-amber-900">
                  <input
                    type="checkbox"
                    checked={matchAsBill[i]}
                    onChange={(e) => setMatchAsBill((m) => m.map((v, j) => (j === i ? e.target.checked : v)))}
                  />
                  <span>
                    Looks like your existing {fmtCurrency(billMatches[i]!.amount)} {billMatches[i]!.billType} bill due{" "}
                    {billMatches[i]!.dueDate} — mark it paid instead of importing as a new expense?
                    {Math.abs(billMatches[i]!.amount - tx.amount) > 0.01 &&
                      ` (bill is ${fmtCurrency(billMatches[i]!.amount)}, statement says ${fmtCurrency(tx.amount)})`}
                  </span>
                </label>
              )}
              {!billMatches[i] && duplicateMatches[i] && (
                <div className="ml-6 flex items-start gap-2 rounded border border-amber-300 bg-amber-50 p-1.5 text-xs text-amber-900">
                  <span>
                    A matching {fmtCurrency(duplicateMatches[i]!.amount)} {duplicateMatches[i]!.kind} already exists on{" "}
                    {duplicateMatches[i]!.date} — check this isn't the same transaction imported before.
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" disabled={!propertyId} onClick={confirm}>
            Import selected
          </Button>
          <Button size="sm" variant="outline" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
    </DocumentReviewCard>
  );
}

function PropertySaleProposalCard({ proposal, onDismiss }: { proposal: AiIntakeProposal; onDismiss: () => void }) {
  const { state, updateProperty, updateAsset, updateProposal, markProposalApplied } = useStore();
  const payload = proposal.payload as PropertySaleProposalPayload;
  const [propertyId, setPropertyId] = useState(proposal.propertyId ?? "");

  const confirm = () => {
    const property = state.properties.find((p) => p.id === propertyId);
    if (!property) return toast.error("Select a property first");
    updateProperty(propertyId, {
      saleDate: payload.saleDate,
      salePrice: payload.salePrice,
      sellingCosts: payload.sellingCosts,
    });
    if (property.assetId) updateAsset(property.assetId, { status: "Sold" });
    markProposalApplied(proposal.id, { propertyId });
    toast.success("Property marked sold");
  };

  // The AI reads "Vendor"/"Purchaser" off the contract but has no way to know which side is
  // actually this landlord — it can get this backwards on a purchase. Re-files this proposal as
  // a property_detail one instead of making the landlord dismiss and re-upload; the buyer name
  // carries over as the owner to link/create as an entity on the (now-correct) review card.
  const reclassifyAsPurchase = () => {
    const detailPayload: PropertyDetailProposalPayload = {
      documentCategory: "Contract of Sale",
      purchaseDate: payload.saleDate,
      purchasePrice: payload.salePrice,
      ownerName: payload.buyerName,
      confidence: payload.confidence,
    };
    updateProposal(proposal.id, { kind: "property_detail", payload: detailPayload });
  };

  return (
    <DocumentReviewCard proposal={proposal}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="destructive">Property sale</Badge>
          {proposal.rawPropertyAddress && <span className="text-xs text-muted-foreground">{proposal.rawPropertyAddress}</span>}
        </div>

        {!proposal.propertyId && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-destructive">No property matched:</span>
            <PropertyPicker propertyId={propertyId} onChange={setPropertyId} />
          </div>
        )}

        <div className="grid grid-cols-2 gap-1 rounded border p-2 text-xs sm:grid-cols-3">
          <div>
            <div className="text-muted-foreground">Sale date</div>
            <div className="font-medium">{payload.saleDate || "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Sale price</div>
            <div className="font-medium">{payload.salePrice ? fmtCurrency(payload.salePrice) : "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Selling costs</div>
            <div className="font-medium">{payload.sellingCosts ? fmtCurrency(payload.sellingCosts) : "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Buyer</div>
            <div className="font-medium">{payload.buyerName || "—"}</div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          This marks the property Sold and records these figures for reference — not a full CGT calculation. Talk to
          your accountant for the actual capital gain/loss.
        </p>
        <p className="text-xs text-amber-700">
          Not right — you're the <span className="font-medium">buyer</span>, not the seller? The AI can get this
          backwards since a contract reads the same either way. Click below to re-file it as a purchase instead.
        </p>

        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" disabled={!propertyId} onClick={confirm}>
            Mark property sold
          </Button>
          <Button size="sm" variant="outline" onClick={reclassifyAsPurchase}>
            Actually, I'm the buyer
          </Button>
          <Button size="sm" variant="outline" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
    </DocumentReviewCard>
  );
}

/** A signed Property Management Agreement, uploaded/emailed in rather than added via the agent
 * Provider's own "Upload & extract" — find-or-creates the agency's identity portfolio-wide by
 * name (mirrors findOrCreateProvider — the same real agency should never get a second identity
 * row just because its agreement arrived through this path instead of the Tenancy tab), then
 * find-or-creates/updates the (provider, property) agreement (filling in blanks only when one
 * already exists, same "fill blanks only" rule the manual extract-and-review form follows) so
 * both entry points land in the same place. */
function AgencyAgreementProposalCard({ proposal, onDismiss }: { proposal: AiIntakeProposal; onDismiss: () => void }) {
  const { state, findOrCreateProvider, updateProvider, addProviderAgreement, updateProviderAgreement, markProposalApplied } = useStore();
  const payload = proposal.payload as AgencyAgreementProposalPayload;
  const [propertyId, setPropertyId] = useState(proposal.propertyId ?? "");
  // Same editable fields (including each fee's own GST-inclusive flag) as the manual "Upload &
  // extract" flow on the agent's Provider record — this review card used to show a read-only
  // summary of only 6 fields with no way to see or fix the AI's GST-inclusive/exclusive read, or
  // to correct a wrong value before it got saved.
  const [form, setForm] = useState<AgreementFormState>(() =>
    agreementFormFrom({ ...payload, contractFileName: proposal.sourceFileName, contractFileData: proposal.sourceFileData }),
  );
  const [busy, setBusy] = useState(false);
  const [extractSummary, setExtractSummary] = useState<{ fields: number; confidence: number } | null>(null);

  const confirm = () => {
    const property = state.properties.find((p) => p.id === propertyId);
    if (!property) return toast.error("Select a property first");

    const providerId = findOrCreateProvider(payload.agencyName || "Managing agent", propertyId);
    updateProvider(providerId, { role: "Agent" });
    const existingAgreement = latestAgreementFor(state.providerAgreements, providerId, propertyId);
    const fields = agreementPayloadFrom(form);
    if (existingAgreement) {
      // Never overwrites a value already on file — same "fill blanks only" rule the manual
      // extract-and-review form follows.
      const patch: Partial<ProviderAgreement> = {};
      for (const [key, value] of Object.entries(fields) as [keyof typeof fields, unknown][]) {
        if (value !== undefined && (existingAgreement as unknown as Record<string, unknown>)[key] === undefined) {
          (patch as Record<string, unknown>)[key] = value;
        }
      }
      updateProviderAgreement(existingAgreement.id, patch);
    } else {
      addProviderAgreement({ providerId, propertyId, ...fields });
    }
    markProposalApplied(proposal.id, { propertyId });
    toast.success(existingAgreement ? "Management agreement applied to existing agent" : "Managing agent added");
  };

  return (
    <DocumentReviewCard proposal={proposal}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">Management agreement</Badge>
          <span className="font-medium">{payload.agencyName || "Unknown agency"}</span>
        </div>

        {!proposal.propertyId && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-destructive">
              No property matched{proposal.rawPropertyAddress ? ` — "${proposal.rawPropertyAddress}"` : ""}
            </span>
            <PropertyPicker propertyId={propertyId} onChange={setPropertyId} />
          </div>
        )}

        <AgreementFields
          form={form}
          setForm={setForm}
          busy={busy}
          extractSummary={extractSummary}
          onFileSelected={(file) => {
            void extractAgreementFile(file, setForm, setBusy, setExtractSummary);
          }}
        />

        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" disabled={!propertyId} onClick={confirm}>
            Save to managing agent
          </Button>
          <Button size="sm" variant="outline" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
    </DocumentReviewCard>
  );
}

export function PropertyDialog({
  property,
  onDone,
  trigger,
  initialAddress,
  onCreated,
}: {
  property: Property | null;
  onDone: () => void;
  trigger?: React.ReactNode;
  /** Pre-fills a *new* property's address from AI-extracted data (e.g. a reviewed rent statement). Ignored in edit mode. */
  initialAddress?: string;
  /** Called after a *new* property is actually created (not on edit, not when the dialog merely opens), with its id. */
  onCreated?: (propertyId: string) => void;
}) {
  const { state, addProperty, updateProperty, findOrCreateEntity, updateAsset } = useStore();
  const asset = property ? state.assets.find((a) => a.id === property.assetId) : undefined;
  const isArchived = asset?.status === "Archived";
  const [creatingEntity, setCreatingEntity] = useState(false);
  const [newEntityName, setNewEntityName] = useState("");
  const [newEntityType, setNewEntityType] = useState<Entity["type"]>("Individual");
  const [open, setOpen] = useState(false);
  const buildForm = () => ({
    address: property?.address ?? initialAddress ?? "",
    alias: property?.alias ?? "",
    entityId: property?.entityId ?? "",
    occupancyType: (property?.occupancyType ?? "") as Property["occupancyType"] | "",
    bedrooms: property?.bedrooms?.toString() ?? "",
    bathrooms: property?.bathrooms?.toString() ?? "",
    carSpaces: property?.carSpaces?.toString() ?? "",
    landSizeSqm: property?.landSizeSqm?.toString() ?? "",
    domainPropertyType: property?.domainPropertyType ?? "",
    dwellingConfiguration: (property?.dwellingConfiguration ?? "House") as Property["dwellingConfiguration"],
  });
  const [form, setForm] = useState(buildForm);
  const [units, setUnits] = useState<PropertyUnit[]>(property?.units ?? []);
  const [addressSuggestions, setAddressSuggestions] = useState<{ id: string; address: string }[]>([]);
  const [addressLookupBusy, setAddressLookupBusy] = useState(false);
  const suggestTimer = useRef<number | null>(null);

  const onAddressChange = (value: string) => {
    setForm((f) => ({ ...f, address: value }));
    if (suggestTimer.current) window.clearTimeout(suggestTimer.current);
    if (value.trim().length < 5) {
      setAddressSuggestions([]);
      return;
    }
    suggestTimer.current = window.setTimeout(async () => {
      try {
        const { data } = await supabase.functions.invoke<DomainSuggestResult>("domain-lookup", {
          body: { mode: "suggest", query: value },
        });
        setAddressSuggestions(data?.ok ? (data.suggestions ?? []) : []);
      } catch {
        // Domain lookup is a convenience only — never blocks typing a plain address by hand.
        setAddressSuggestions([]);
      }
    }, 400);
  };

  const pickAddressSuggestion = async (s: { id: string; address: string }) => {
    setForm((f) => ({ ...f, address: s.address }));
    setAddressSuggestions([]);
    setAddressLookupBusy(true);
    try {
      const { data } = await supabase.functions.invoke<DomainDetailsResult>("domain-lookup", {
        body: { mode: "details", propertyId: s.id },
      });
      if (data?.ok) {
        setForm((f) => ({
          ...f,
          bedrooms: f.bedrooms || (data.bedrooms != null ? String(data.bedrooms) : f.bedrooms),
          bathrooms: f.bathrooms || (data.bathrooms != null ? String(data.bathrooms) : f.bathrooms),
          carSpaces: f.carSpaces || (data.carSpaces != null ? String(data.carSpaces) : f.carSpaces),
          landSizeSqm: f.landSizeSqm || (data.landSizeSqm != null ? String(data.landSizeSqm) : f.landSizeSqm),
          domainPropertyType: f.domainPropertyType || data.domainPropertyType || f.domainPropertyType,
        }));
        toast.success("Filled details from Domain");
      } else if (data?.error) {
        toast.error(data.error);
      }
    } catch {
      toast.error("Couldn't fetch property details from Domain");
    } finally {
      setAddressLookupBusy(false);
    }
  };

  const addUnit = () =>
    setUnits((rows) => [...rows, { id: uid("unit"), label: rows.length === 0 ? "Main house" : `Unit ${rows.length + 1}` }]);
  const removeUnit = (idx: number) => setUnits((rows) => rows.filter((_, i) => i !== idx));
  const updateUnit = (idx: number, patch: Partial<PropertyUnit>) =>
    setUnits((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const currentTenant = property ? state.tenants.find((t) => t.propertyId === property.id) : undefined;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setForm(buildForm());
          setUnits(property?.units ?? []);
          setAddressSuggestions([]);
          setCreatingEntity(false);
          setNewEntityName("");
        } else {
          onDone();
        }
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button onClick={() => setOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" /> Add Property
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{property ? "Edit property" : "New property"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="relative">
            <Field label="Address">
              <Input
                value={form.address}
                onChange={(e) => onAddressChange(e.target.value)}
                onBlur={() => window.setTimeout(() => setAddressSuggestions([]), 150)}
                placeholder="Start typing — Domain will suggest matches"
              />
            </Field>
            {addressSuggestions.length > 0 && (
              <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-md">
                {addressSuggestions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onMouseDown={() => pickAddressSuggestion(s)}
                    className="block w-full truncate px-3 py-2 text-left text-sm hover:bg-muted"
                  >
                    {s.address}
                  </button>
                ))}
              </div>
            )}
            {addressLookupBusy && <div className="mt-1 text-xs text-muted-foreground">Fetching property details from Domain…</div>}
          </div>

          <Field label="Dwelling configuration">
            <Select
              value={form.dwellingConfiguration}
              onValueChange={(v) => {
                const next = v as Property["dwellingConfiguration"];
                setForm({ ...form, dwellingConfiguration: next });
                if (next !== "House" && units.length === 0) {
                  setUnits(
                    next === "Dual Key"
                      ? [{ id: uid("unit"), label: "Unit 1" }, { id: uid("unit"), label: "Unit 2" }]
                      : [{ id: uid("unit"), label: "Main house" }, { id: uid("unit"), label: "Granny flat" }],
                  );
                }
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="House">House (single dwelling)</SelectItem>
                <SelectItem value="Dual Key">Dual Key</SelectItem>
                <SelectItem value="House + Granny Flat">House + Granny Flat</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          {form.dwellingConfiguration !== "House" && (
            <div className="rounded-md border p-3">
              <div className="mb-2 text-sm font-medium">Dwellings on this title</div>
              <div className="space-y-2">
                {units.map((u, idx) => (
                  <div key={idx} className="grid grid-cols-[1fr_2fr_1fr_1fr_auto] items-end gap-2">
                    <Field label="Label">
                      <Input value={u.label} onChange={(e) => updateUnit(idx, { label: e.target.value })} />
                    </Field>
                    <Field label="Address">
                      <Input value={u.address ?? ""} onChange={(e) => updateUnit(idx, { address: e.target.value })} placeholder="e.g. 10A Facer Ct" />
                    </Field>
                    <Field label="Beds">
                      <Input
                        type="number"
                        value={u.bedrooms ?? ""}
                        onChange={(e) => updateUnit(idx, { bedrooms: e.target.value ? parseFloat(e.target.value) : undefined })}
                      />
                    </Field>
                    <Field label="Baths">
                      <Input
                        type="number"
                        value={u.bathrooms ?? ""}
                        onChange={(e) => updateUnit(idx, { bathrooms: e.target.value ? parseFloat(e.target.value) : undefined })}
                      />
                    </Field>
                    <Button size="icon" variant="ghost" onClick={() => removeUnit(idx)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button size="sm" variant="outline" className="mt-2 gap-1" onClick={addUnit}>
                <Plus className="h-3 w-3" /> Add dwelling
              </Button>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Property name / alias">
              <Input
                value={form.alias}
                onChange={(e) => setForm({ ...form, alias: e.target.value })}
                placeholder="e.g. The Rose St Duplex"
              />
            </Field>
            <Field label="Property type">
              <Input
                value={form.domainPropertyType}
                onChange={(e) => setForm({ ...form, domainPropertyType: e.target.value })}
                placeholder="e.g. House, Townhouse, Unit"
              />
            </Field>
            <Field label="Bedrooms">
              <Input type="number" value={form.bedrooms} onChange={(e) => setForm({ ...form, bedrooms: e.target.value })} />
            </Field>
            <Field label="Bathrooms">
              <Input type="number" value={form.bathrooms} onChange={(e) => setForm({ ...form, bathrooms: e.target.value })} />
            </Field>
            <Field label="Car spaces">
              <Input type="number" value={form.carSpaces} onChange={(e) => setForm({ ...form, carSpaces: e.target.value })} />
            </Field>
            <Field label="Land size (m²)">
              <Input type="number" value={form.landSizeSqm} onChange={(e) => setForm({ ...form, landSizeSqm: e.target.value })} />
            </Field>
          </div>

          {currentTenant && (
            <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
              Current tenant: <span className="font-medium text-foreground">{currentTenant.name}</span> —{" "}
              {fmtCurrency(currentTenant.rentAmount)}/{currentTenant.rentFrequency}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Entity (ownership)">
              {creatingEntity ? (
                <div className="flex items-center gap-1">
                  <Input value={newEntityName} onChange={(e) => setNewEntityName(e.target.value)} placeholder="New entity name" className="flex-1" />
                  <Select value={newEntityType} onValueChange={(v) => setNewEntityType(v as Entity["type"])}>
                    <SelectTrigger className="w-[110px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Individual">Individual</SelectItem>
                      <SelectItem value="Joint">Joint</SelectItem>
                      <SelectItem value="Trust">Trust</SelectItem>
                      <SelectItem value="SMSF">SMSF</SelectItem>
                      <SelectItem value="Company">Company</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button size="icon" variant="ghost" onClick={() => { setCreatingEntity(false); setNewEntityName(""); }}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <Select
                  value={form.entityId || "__none__"}
                  onValueChange={(v) => {
                    if (v === "__new__") { setCreatingEntity(true); return; }
                    setForm({ ...form, entityId: v === "__none__" ? "" : v });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Unassigned</SelectItem>
                    {state.entities.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.name}
                      </SelectItem>
                    ))}
                    <SelectItem value="__new__">+ Create new entity…</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </Field>
            <Field label="Occupancy">
              <Select
                value={form.occupancyType || "__unset__"}
                onValueChange={(v) =>
                  setForm({ ...form, occupancyType: v === "__unset__" ? "" : (v as Property["occupancyType"]) })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__unset__">Not set</SelectItem>
                  <SelectItem value="Investment">Investment</SelectItem>
                  <SelectItem value="PPOR">PPOR (main residence)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

        </div>
        <DialogFooter>
          {asset && (
            <Button
              type="button"
              variant="outline"
              className="mr-auto"
              onClick={() => {
                if (
                  !isArchived &&
                  !confirm(
                    `Archive ${property?.alias || property?.address}? It'll be hidden from Assets, but every tenant, bill, transaction and document stays intact — unarchive any time.`,
                  )
                ) {
                  return;
                }
                updateAsset(asset.id, { status: isArchived ? "Active" : "Archived" });
                toast.success(isArchived ? "Property unarchived" : "Property archived");
                setOpen(false);
                onDone();
              }}
            >
              {isArchived ? "Unarchive" : "Archive"}
            </Button>
          )}
          <Button
            onClick={() => {
              if (!form.address) return toast.error("Address required");
              const payload = {
                address: form.address,
                alias: form.alias || undefined,
                entityId:
                  creatingEntity && newEntityName.trim()
                    ? findOrCreateEntity(newEntityName, newEntityType)
                    : form.entityId || undefined,
                occupancyType: form.occupancyType || undefined,
                bedrooms: form.bedrooms ? parseFloat(form.bedrooms) : undefined,
                bathrooms: form.bathrooms ? parseFloat(form.bathrooms) : undefined,
                carSpaces: form.carSpaces ? parseFloat(form.carSpaces) : undefined,
                landSizeSqm: form.landSizeSqm ? parseFloat(form.landSizeSqm) : undefined,
                domainPropertyType: form.domainPropertyType || undefined,
                dwellingConfiguration: form.dwellingConfiguration,
                units: form.dwellingConfiguration !== "House" && units.length > 0 ? units : undefined,
              };
              if (property) {
                updateProperty(property.id, payload);
              } else {
                const newId = addProperty({ ...payload, purchasePrice: 0, currentValue: 0 });
                onCreated?.(newId);
              }
              setOpen(false);
              onDone();
              toast.success("Property saved");
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Merges the old separate Overview and Performance tabs into one "Performance & Summary" view.
 * Insurance expiry/Compliance due are read from the InsurancePolicy/ComplianceCertificate
 * systems of record instead of the deprecated Property-level quick-fields. */
export function PropertySummaryTab({
  prop,
  loan,
  tenants,
  expenses,
}: {
  prop: Property;
  loan?: Loan;
  tenants: Tenant[];
  expenses: Expense[];
}) {
  const { state } = useStore();
  const currentFY = ausFinancialYear(todayISO());
  const { start, end } = fyRange(currentFY);
  const tenantIds = tenants.map((t) => t.id);
  const ytdIncome = state.ledger
    .filter((e) => tenantIds.includes(e.tenantId) && e.type === "Rent Payment" && e.date >= start && e.date <= end)
    .reduce((s, e) => s + e.credit, 0);
  const activeTenant = tenants[0];
  const nextBill = state.bills
    .filter((b) => b.propertyId === prop.id && b.status !== "Paid")
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))[0];
  const equity = prop.currentValue - (loan?.totalBalance ?? 0);
  const insuranceExpiry = state.insurancePolicies
    .filter((p) => p.propertyId === prop.id && p.coverEnd)
    .map((p) => p.coverEnd as string)
    .sort()[0];
  const complianceDue = state.complianceCertificates
    .filter((c) => c.propertyId === prop.id && c.expiryDate)
    .map((c) => c.expiryDate as string)
    .sort()[0];

  const annualRent = activeTenant
    ? activeTenant.rentFrequency === "Weekly"
      ? activeTenant.rentAmount * 52
      : activeTenant.rentFrequency === "Fortnightly"
        ? activeTenant.rentAmount * 26
        : activeTenant.rentAmount * 12
    : 0;
  const ytdExpenses = expenses.filter((e) => e.date >= start && e.date <= end).reduce((s, e) => s + e.cost, 0);
  const loanInterest = loan ? (loan.totalBalance * loan.interestRate) / 100 : 0;
  const grossYield = prop.currentValue > 0 ? (annualRent / prop.currentValue) * 100 : 0;
  const netYield = prop.currentValue > 0 ? ((annualRent - ytdExpenses - loanInterest) / prop.currentValue) * 100 : 0;
  const cashInvested = (prop.deposit ?? 0) + (prop.stampDuty ?? 0);
  const cashOnCash = cashInvested > 0 ? ((annualRent - ytdExpenses - loanInterest) / cashInvested) * 100 : undefined;

  return (
    <div className="space-y-5 text-sm">
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Property value" value={fmtCurrency(prop.currentValue)} />
        <Stat label="Purchase price" value={fmtCurrency(prop.purchasePrice)} />
        <Stat label="Current equity" value={fmtCurrency(equity)} />
        <Stat label="Loan balance" value={fmtCurrency(loan?.totalBalance ?? 0)} />
        <Stat label="Offset balance" value={loan?.offsetBalance ? fmtCurrency(loan.offsetBalance) : "—"} />
        <Stat label="Weekly rent" value={activeTenant ? `${fmtCurrency(activeTenant.rentAmount)}/${activeTenant.rentFrequency}` : "—"} />
        <Stat label="Current tenant" value={activeTenant?.name || "—"} />
        <Stat label="Lease end date" value={activeTenant?.leaseExpiry || "—"} />
        <Stat
          label="Next bill due"
          value={nextBill ? `${nextBill.billType} · ${fmtCurrency(nextBill.amount)} · ${nextBill.dueDate}` : "—"}
        />
        <Stat label="Insurance expiry" value={insuranceExpiry || "—"} />
        <Stat label="Compliance due" value={complianceDue || "—"} />
        <Stat label="YTD income" value={fmtCurrency(ytdIncome)} />
      </div>

      <div className="border-t pt-4">
        <p className="mb-2 text-xs text-muted-foreground">
          Estimates based on the current tenant's rent annualised and this FY's expenses — not a formal valuation.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Gross yield" value={`${grossYield.toFixed(2)}%`} />
          <Stat label="Net yield" value={`${netYield.toFixed(2)}%`} />
          <Stat label="Cash-on-cash return" value={cashOnCash !== undefined ? `${cashOnCash.toFixed(2)}%` : "— (no deposit/stamp duty on file)"} />
          <Stat label="Annualised rent" value={fmtCurrency(annualRent)} />
        </div>
      </div>
    </div>
  );
}

/** Expense categories (from CATEGORY_GROUPS' "Cost Base (Capital)" group) that represent money
 * spent to ACQUIRE the property — legal/agent/inspection fees — distinct from stampDuty (its own
 * Property field, added separately below) and from post-purchase capital works (Capital
 * Improvement, Initial Repairs), which grow the cost base for CGT but were never part of "what did
 * settlement actually cost". */
const BUYING_COST_CATEGORIES: ExpenseCategory[] = [
  "Conveyancer Fees",
  "Conveyancing / Legal (Purchase)",
  "Buyer's Agent Fee",
  "Building / Pest Inspection (Purchase)",
];

function fmtCompactCurrency(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1000)}k`;
  return `${sign}${fmtCurrency(abs)}`;
}

/**
 * Bisection IRR solver over a simplified annual cashflow model — a lump initial outflow, the
 * recorded net cashflow spread evenly across the (possibly fractional) years held, and a terminal
 * value discounted at the end of that period. This isn't a full irregular-cashflow IRR (this app
 * doesn't track exact historical per-period cashflow, only a lump total — see recordedNetCashflow
 * below), but unlike a plain start/end CAGR it does discount interim cashflows for their timing,
 * which is the actual difference between "IRR" and "annualised return" a landlord would expect to
 * see reported separately.
 */
function solveIrr(cashInvested: number, annualCashflow: number, years: number, terminalValue: number): number | null {
  if (!(cashInvested > 0) || !(years > 0)) return null;
  const npv = (r: number) => {
    let sum = -cashInvested;
    const fullYears = Math.floor(years);
    for (let t = 1; t <= fullYears; t++) sum += annualCashflow / Math.pow(1 + r, t);
    const fracYear = years - fullYears;
    if (fracYear > 0.001) sum += (annualCashflow * fracYear) / Math.pow(1 + r, years);
    sum += terminalValue / Math.pow(1 + r, years);
    return sum;
  };
  let lo = -0.99;
  let hi = 5;
  let npvLo = npv(lo);
  const npvHi = npv(hi);
  if (!Number.isFinite(npvLo) || !Number.isFinite(npvHi) || npvLo * npvHi > 0) return null;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const npvMid = npv(mid);
    if (Math.abs(npvMid) < 1) return mid;
    if (npvMid > 0 === npvLo > 0) {
      lo = mid;
      npvLo = npvMid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

interface ValuePoint {
  date: string;
  value: number;
}

/** Geometric (compounding) interpolation between known actual value points, monthly steps — fills
 * in the dashed "Estimated" trend line the value-journey chart draws between sparse real data (a
 * ValuationSnapshot is only taken when currentValue actually changes, see snapshotValuation in
 * store.tsx, so most properties only have a couple of real points). Falls back to linear
 * interpolation if either endpoint is zero/negative, where geometric interpolation is undefined. */
function interpolateValueJourney(points: ValuePoint[]): ValuePoint[] {
  if (points.length < 2) return points;
  const out: ValuePoint[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const aDate = new Date(a.date);
    const bDate = new Date(b.date);
    const totalMonths = Math.max(1, Math.round((bDate.getTime() - aDate.getTime()) / (30.44 * 24 * 3600 * 1000)));
    for (let m = i === 0 ? 0 : 1; m <= totalMonths; m++) {
      const t = m / totalMonths;
      const value = a.value > 0 && b.value > 0 ? a.value * Math.pow(b.value / a.value, t) : a.value + (b.value - a.value) * t;
      const d = new Date(aDate);
      d.setMonth(d.getMonth() + m);
      out.push({ date: d.toISOString().slice(0, 10), value });
    }
  }
  return out;
}

/** Minimal, dependency-free line chart — a value trend line doesn't need a charting library, and
 * this app doesn't otherwise pull one in (see the plain-CSS bars used elsewhere, e.g. this tab's
 * own "where the return came from" bars, or PropertyPnLTab's "Where it goes"). Draws the
 * interpolated "Estimated" series as a dashed path and every real data point (purchase price,
 * ValuationSnapshots, today's value) as a solid dot. */
function ValueJourneyChart({ actualPoints, estimatedPoints }: { actualPoints: ValuePoint[]; estimatedPoints: ValuePoint[] }) {
  const width = 600;
  const height = 180;
  const padding = { top: 10, right: 10, bottom: 20, left: 8 };
  const values = estimatedPoints.map((p) => p.value);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const valueRange = maxValue - minValue || 1;
  const startTime = new Date(estimatedPoints[0].date).getTime();
  const endTime = new Date(estimatedPoints[estimatedPoints.length - 1].date).getTime();
  const timeRange = endTime - startTime || 1;

  const x = (date: string) => padding.left + ((new Date(date).getTime() - startTime) / timeRange) * (width - padding.left - padding.right);
  const y = (value: number) => padding.top + (1 - (value - minValue) / valueRange) * (height - padding.top - padding.bottom);

  const pathD = estimatedPoints.map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.date).toFixed(1)} ${y(p.value).toFixed(1)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-48 w-full text-muted-foreground" preserveAspectRatio="none">
      <line x1={padding.left} y1={y(maxValue)} x2={width - padding.right} y2={y(maxValue)} stroke="currentColor" strokeOpacity={0.15} />
      <line x1={padding.left} y1={y(minValue)} x2={width - padding.right} y2={y(minValue)} stroke="currentColor" strokeOpacity={0.15} />
      <text x={padding.left} y={Math.max(10, y(maxValue) - 4)} fontSize={10} fill="currentColor">
        {fmtCompactCurrency(maxValue)}
      </text>
      <text x={padding.left} y={Math.min(height - 24, y(minValue) + 12)} fontSize={10} fill="currentColor">
        {fmtCompactCurrency(minValue)}
      </text>
      <path d={pathD} fill="none" stroke="var(--primary)" strokeWidth={2} strokeDasharray="5 4" />
      {actualPoints.map((p) => (
        <circle key={p.date} cx={x(p.date)} cy={y(p.value)} r={3.5} fill="var(--primary)" />
      ))}
      <text x={padding.left} y={height - 4} fontSize={10} fill="currentColor">
        {new Date(estimatedPoints[0].date).toLocaleDateString("en-AU", { month: "short", year: "numeric" })}
      </text>
      <text x={width - padding.right} y={height - 4} fontSize={10} fill="currentColor" textAnchor="end">
        {new Date(estimatedPoints[estimatedPoints.length - 1].date).toLocaleDateString("en-AU", { month: "short", year: "numeric" })}
      </text>
    </svg>
  );
}

function PerfTile({ label, value, caption, tooltip }: { label: string; value: string; caption?: string; tooltip?: string }) {
  return (
    <div className="rounded-md bg-muted p-3">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <span>{label}</span>
        {tooltip && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-3 w-3 shrink-0 cursor-help" aria-label={`How ${label} is calculated`} />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">{tooltip}</TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className="mt-1 text-base font-semibold">{value}</div>
      {caption && <div className="mt-0.5 text-xs text-muted-foreground">{caption}</div>}
    </div>
  );
}

/**
 * Whole-of-hold performance — how this property has actually done since purchase, distinct from
 * PropertySummaryTab's snapshot stats (this-FY-only) and the Forecasts tab (forward-looking
 * projection). Reuses computeAnnualBaseline for today's run-rate figures (yields, cash-on-cash)
 * but its "recorded net cashflow"/IRR are built from real transaction history, not projected.
 */
export function PropertyPerformanceTab({ prop, loan, tenants, expenses }: { prop: Property; loan?: Loan; tenants: Tenant[]; expenses: Expense[] }) {
  const { state } = useStore();
  const baseline = computeAnnualBaseline(prop, loan, tenants);
  const now = Date.now();

  const purchasePrice = prop.purchasePrice || 0;
  const currentValue = prop.currentValue || 0;
  const stampDuty = prop.stampDuty ?? 0;
  const buyingCosts = expenses
    .filter((e) => BUYING_COST_CATEGORIES.includes((e.category ?? "") as ExpenseCategory))
    .reduce((s, e) => s + e.cost, 0);
  const upfrontCosts = stampDuty + buyingCosts;
  // Total cost base for the return/yield ratios below — purchase price plus everything spent to
  // acquire AND improve it (post-purchase "Capital Improvement" expenses count too; ongoing
  // repairs/maintenance don't, those are running expenses, not capital). Distinct from Cash
  // Invested's own breakdown further down, which is about how the purchase was FUNDED, not the
  // full capital deployed into the asset since.
  const capitalImprovements = expenses.filter((e) => e.category === "Capital Improvement").reduce((s, e) => s + e.cost, 0);
  const costBase = purchasePrice + upfrontCosts + capitalImprovements;
  const startingLoanBalance = loan?.originalAmount ?? 0;
  const cashInvested = Math.max(0, purchasePrice + upfrontCosts - startingLoanBalance);

  const debt = loan?.totalBalance ?? 0;
  const equity = currentValue - debt;
  const usableEquity = Math.max(0, currentValue * 0.8 - debt);
  const lvr = currentValue > 0 ? (debt / currentValue) * 100 : 0;

  const purchaseDate = prop.purchaseDate;
  const yearsHeld = purchaseDate ? Math.max((now - new Date(purchaseDate).getTime()) / (365.25 * 24 * 3600 * 1000), 1 / 365) : null;
  // Annualizing a hold shorter than a year produces a wildly misleading extrapolated rate (a
  // month of growth compounded to "per year") — both annualized figures below are gated on it.
  const hasFullYearHeld = yearsHeld !== null && yearsHeld >= 1;

  const capitalGrowthDollar = currentValue - purchasePrice;
  const capitalGrowthPct =
    hasFullYearHeld && purchasePrice > 0 ? (Math.pow(currentValue / purchasePrice, 1 / (yearsHeld as number)) - 1) * 100 : null;
  const capitalGrowthNetOfCosts = currentValue - costBase;

  const grossYield = currentValue > 0 ? (baseline.annualRent / currentValue) * 100 : 0;
  const netYield = currentValue > 0 ? ((baseline.annualRent - baseline.opEx) / currentValue) * 100 : 0;
  const yieldOnPurchase = purchasePrice > 0 ? (baseline.annualRent / purchasePrice) * 100 : 0;
  const yieldOnCost = costBase > 0 ? (baseline.annualRent / costBase) * 100 : 0;
  // Pre-tax, using today's rent/costs/loan — not the "recorded" historical figures below.
  const cashOnCash = cashInvested > 0 ? (baseline.netCashflow / cashInvested) * 100 : null;

  // Recorded net cashflow — actual logged rent/expenses since the earliest date this property has
  // real transaction history for, which may be well after purchaseDate if the property joined the
  // app partway through ownership. Nothing is estimated here (no transactions on file means this
  // is exactly $0, not a guess) — this is deliberately a plainer, more conservative figure than
  // computeAnnualBaseline's projected netCashflow above.
  const tenantIds = tenants.map((t) => t.id);
  const rentEntries = state.ledger.filter((e) => tenantIds.includes(e.tenantId) && e.type === "Rent Payment");
  const recordDates = [...rentEntries.map((e) => e.date), ...expenses.map((e) => e.date)].filter(Boolean).sort();
  const cashflowStart = recordDates[0] ?? purchaseDate ?? todayISO();
  const recordedRent = rentEntries.filter((e) => e.date >= cashflowStart).reduce((s, e) => s + e.credit, 0);
  const recordedExpensesOut = expenses.filter((e) => e.date >= cashflowStart && e.direction !== "Income").reduce((s, e) => s + e.cost, 0);
  const recordedExtraIncome = expenses.filter((e) => e.date >= cashflowStart && e.direction === "Income").reduce((s, e) => s + e.cost, 0);
  const recordedNetCashflow = recordedRent + recordedExtraIncome - recordedExpensesOut;

  const totalReturnDollar = capitalGrowthNetOfCosts + recordedNetCashflow;
  const totalReturnPctPa =
    hasFullYearHeld && costBase > 0 ? (Math.pow(1 + totalReturnDollar / costBase, 1 / (yearsHeld as number)) - 1) * 100 : null;
  const irr = yearsHeld && cashInvested > 0 ? solveIrr(cashInvested, recordedNetCashflow / Math.max(yearsHeld, 1), yearsHeld, equity) : null;

  // Value journey — see interpolateValueJourney's doc for why the line between real points is an
  // interpolation, not a claim about value on any specific day.
  const snapshots = state.valuationSnapshots.filter((v) => v.assetId === prop.assetId).map((v) => ({ date: v.date, value: v.value }));
  const journeyPoints: ValuePoint[] = [];
  if (purchaseDate && purchasePrice > 0) journeyPoints.push({ date: purchaseDate, value: purchasePrice });
  journeyPoints.push(...snapshots);
  if (currentValue > 0) journeyPoints.push({ date: todayISO(), value: currentValue });
  journeyPoints.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const dedupedActual = journeyPoints.filter((p, i, arr) => i === arr.length - 1 || p.date !== arr[i + 1].date);
  const journeyEstimatedPoints = interpolateValueJourney(dedupedActual);

  // Cashflow break-even — a lightweight year-by-year projection at a flat 3%/3% rent/expense
  // growth (the same default the Forecasts tab starts from), just to answer "when", not a full
  // model of its own.
  let breakEvenYear: number | null = null;
  if (baseline.annualRent > 0) {
    if (baseline.netCashflow >= 0) {
      breakEvenYear = 0;
    } else {
      let rent = baseline.annualRent;
      let opEx = baseline.opEx;
      for (let y = 1; y <= 40; y++) {
        rent *= 1.03;
        opEx *= 1.03;
        if (rent - opEx - baseline.totalLoanRepayments >= 0) {
          breakEvenYear = y;
          break;
        }
      }
    }
  }

  const fundedByLoanPct = purchasePrice > 0 ? Math.min(100, (startingLoanBalance / purchasePrice) * 100) : 0;
  const cashPct = purchasePrice + upfrontCosts > 0 ? (cashInvested / (purchasePrice + upfrontCosts)) * 100 : 0;
  const returnMagnitude = Math.abs(capitalGrowthNetOfCosts) + Math.abs(recordedNetCashflow) || 1;

  return (
    <div className="space-y-4 text-sm">
      <Card>
        <CardContent className="space-y-4 p-4">
          <TooltipProvider delayDuration={200}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <PerfTile
                label="Total return"
                value={totalReturnPctPa !== null ? `${totalReturnPctPa.toFixed(1)}% p.a.` : "—"}
                caption={
                  !purchaseDate
                    ? "Add a purchase date"
                    : !hasFullYearHeld
                      ? "Needs at least 1 year of ownership"
                      : `${totalReturnDollar >= 0 ? "+" : ""}${fmtCurrency(totalReturnDollar)} over the hold`
                }
                tooltip={`Compound annual return: (1 + total return ÷ cost base) ^ (1 ÷ years held) − 1. Cashflow is counted from this property's first recorded transaction (${cashflowStart}) — periods before that aren't included. Needs at least 1 year of ownership.`}
              />
              <PerfTile
                label="Capital growth"
                value={capitalGrowthPct !== null ? `${capitalGrowthPct.toFixed(1)}% p.a.` : "—"}
                caption={
                  !purchaseDate
                    ? "Add a purchase date"
                    : !hasFullYearHeld
                      ? "Needs at least 1 year of ownership"
                      : `${capitalGrowthDollar >= 0 ? "+" : ""}${fmtCurrency(capitalGrowthDollar)} since purchase`
                }
                tooltip="Compound annual growth rate: (current value ÷ purchase price) ^ (1 ÷ years held) − 1. Needs at least 1 year of ownership."
              />
              <PerfTile
                label="Yield on cost"
                value={`${yieldOnCost.toFixed(1)}%`}
                caption={`rent ${fmtCurrency(baseline.annualRent)}/yr`}
                tooltip="Annual rent ÷ (purchase price + stamp duty & buying costs + capital improvements). Uses your current lease's annualised rent."
              />
              <PerfTile
                label="Cash-on-cash"
                value={cashOnCash !== null ? `${cashOnCash.toFixed(1)}%` : "—"}
                caption={`${baseline.netCashflow >= 0 ? "+" : ""}${fmtCurrency(baseline.netCashflow)}/yr · ${baseline.netCashflow < 0 ? "negative" : "positive"} gearing`}
                tooltip="Net annual cashflow ÷ cash invested. Pre-tax, using your current rent, costs, and loan figures."
              />
            </div>
          </TooltipProvider>
          <div className="space-y-1">
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-2 bg-primary"
                style={{ width: `${currentValue > 0 ? Math.max(0, Math.min(100, (equity / currentValue) * 100)) : 0}%` }}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-1 text-xs text-muted-foreground">
              <span>
                Debt {fmtCurrency(debt)} · Equity {fmtCurrency(equity)} <span className="opacity-70">(usable {fmtCurrency(usableEquity)})</span>
              </span>
              <span>LVR {lvr.toFixed(1)}%</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Value journey</CardTitle>
          <div className="text-xs text-muted-foreground">Purchase to today</div>
        </CardHeader>
        <CardContent>
          {journeyEstimatedPoints.length >= 2 ? (
            <ValueJourneyChart actualPoints={dedupedActual} estimatedPoints={journeyEstimatedPoints} />
          ) : (
            <div className="rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground">
              Add a purchase price/date and a current value to chart this property's value over time.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Yields</CardTitle>
          <div className="text-xs text-muted-foreground">
            Rent {fmtCurrency(baseline.annualRent)}/yr (current lease) · opex {fmtCurrency(baseline.opEx)}/yr
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <PerfTile label="Gross yield" value={`${grossYield.toFixed(1)}%`} />
          <PerfTile label="Net yield" value={`${netYield.toFixed(1)}%`} caption="After operating expenses" />
          <PerfTile label="Yield on purchase" value={`${yieldOnPurchase.toFixed(1)}%`} caption="On your purchase price" />
          <PerfTile label="Yield on cost" value={`${yieldOnCost.toFixed(1)}%`} caption={`Cost base ${fmtCurrency(costBase)}`} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cashflow break-even</CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground">
          {baseline.annualRent <= 0 ? (
            <>
              <div className="font-medium text-foreground">Not enough data yet</div>
              <div>Add a rent figure and the break-even projection fills in.</div>
            </>
          ) : breakEvenYear === 0 ? (
            <div className="text-sm font-medium text-emerald-600">Already cashflow positive at current rent and costs.</div>
          ) : breakEvenYear !== null ? (
            <div className="text-sm text-foreground">
              Projected to reach cashflow break-even in <span className="font-medium">Year {breakEvenYear}</span>, assuming rent and costs
              both grow ~3% p.a.
            </div>
          ) : (
            <div>Costs are projected to keep outpacing rent — no break-even within 40 years at these settings.</div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Where the return came from</CardTitle>
            <div className="text-xs text-muted-foreground">Cashflow recorded from {cashflowStart}</div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Capital growth (net of buying costs)</span>
                <span className={capitalGrowthNetOfCosts < 0 ? "text-destructive" : "text-emerald-600"}>
                  {capitalGrowthNetOfCosts >= 0 ? "+" : ""}
                  {fmtCurrency(capitalGrowthNetOfCosts)}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-1.5 ${capitalGrowthNetOfCosts < 0 ? "bg-destructive" : "bg-emerald-600"}`}
                  style={{ width: `${Math.min(100, (Math.abs(capitalGrowthNetOfCosts) / returnMagnitude) * 100)}%` }}
                />
              </div>
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Recorded net cashflow</span>
                <span className={recordedNetCashflow < 0 ? "text-destructive" : "text-emerald-600"}>
                  {recordedNetCashflow >= 0 ? "+" : ""}
                  {fmtCurrency(recordedNetCashflow)}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-1.5 ${recordedNetCashflow < 0 ? "bg-destructive" : "bg-emerald-600"}`}
                  style={{ width: `${Math.min(100, (Math.abs(recordedNetCashflow) / returnMagnitude) * 100)}%` }}
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 border-t pt-3 text-center">
              <div>
                <div className="text-xs text-muted-foreground">Total</div>
                <div className={`text-sm font-semibold ${totalReturnDollar < 0 ? "text-destructive" : "text-emerald-600"}`}>
                  {totalReturnDollar >= 0 ? "+" : ""}
                  {fmtCurrency(totalReturnDollar)}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Annualised</div>
                <div className="text-sm font-semibold">{totalReturnPctPa !== null ? `${totalReturnPctPa.toFixed(1)}% p.a.` : "—"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">IRR</div>
                <div className="text-sm font-semibold">{irr !== null ? `${(irr * 100).toFixed(1)}% p.a.` : "—"}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cash invested</CardTitle>
            <div className="text-xs text-muted-foreground">Derived from purchase price, buying costs and starting loan balance</div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">How the purchase was funded</div>
              <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
                {fundedByLoanPct > 0 && <div className="h-2 bg-destructive" style={{ width: `${fundedByLoanPct}%` }} />}
                <div className="h-2 bg-primary" style={{ width: `${Math.max(0, 100 - fundedByLoanPct)}%` }} />
              </div>
              <div className="flex flex-wrap justify-between gap-1 text-xs text-muted-foreground">
                <span>
                  Borrowed {fmtCurrency(startingLoanBalance)} ({fundedByLoanPct.toFixed(0)}%)
                </span>
                <span>
                  Your cash {fmtCurrency(cashInvested)} ({cashPct.toFixed(0)}%)
                </span>
              </div>
            </div>
            <div className="space-y-1 border-t pt-3 text-xs">
              <div className="flex justify-between">
                <span>Purchase price</span>
                <span>{fmtCurrency(purchasePrice)}</span>
              </div>
              <div className="flex justify-between">
                <span>+ Stamp duty &amp; buying costs</span>
                <span>{fmtCurrency(upfrontCosts)}</span>
              </div>
              <div className="flex justify-between">
                <span>− Starting loan balance</span>
                <span>{fmtCurrency(startingLoanBalance)}</span>
              </div>
              <div className="flex justify-between border-t pt-1 font-medium">
                <span>= Cash invested</span>
                <span>{fmtCurrency(cashInvested)}</span>
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              Cash invested drives cash-on-cash return and IRR — it's the deposit plus buying costs you actually paid, not the
              property price.
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function purchaseAcquisitionFormOf(prop: Property) {
  return {
    purchasePrice: prop.purchasePrice?.toString() ?? "",
    currentValue: prop.currentValue?.toString() ?? "",
    purchaseDate: prop.purchaseDate ?? "",
    stampDuty: prop.stampDuty?.toString() ?? "",
    deposit: prop.deposit?.toString() ?? "",
    lotSize: prop.lotSize ?? "",
    physicalAttributes: prop.physicalAttributes ?? "",
    lender: prop.lender ?? "",
    loanAccountRef: prop.loanAccountRef ?? "",
    loanBalance: prop.loanBalance?.toString() ?? "",
    interestRate: prop.interestRate?.toString() ?? "",
    repaymentFrequency: (prop.repaymentFrequency ?? "Monthly") as RepaymentFrequency,
  };
}

function PurchaseAcquisitionDialog({ prop, trigger }: { prop: Property; trigger?: React.ReactNode }) {
  const { updateProperty } = useStore();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(() => purchaseAcquisitionFormOf(prop));

  const save = () => {
    updateProperty(prop.id, {
      purchasePrice: form.purchasePrice ? parseFloat(form.purchasePrice) : 0,
      currentValue: form.currentValue ? parseFloat(form.currentValue) : 0,
      purchaseDate: form.purchaseDate || undefined,
      stampDuty: form.stampDuty ? parseFloat(form.stampDuty) : undefined,
      deposit: form.deposit ? parseFloat(form.deposit) : undefined,
      lotSize: form.lotSize || undefined,
      physicalAttributes: form.physicalAttributes || undefined,
      lender: form.lender || undefined,
      loanAccountRef: form.loanAccountRef || undefined,
      loanBalance: form.loanBalance ? parseFloat(form.loanBalance) : undefined,
      interestRate: form.interestRate ? parseFloat(form.interestRate) : undefined,
      repaymentFrequency: form.repaymentFrequency,
    });
    toast.success("Purchase & acquisition details saved");
    setOpen(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setForm(purchaseAcquisitionFormOf(prop));
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="icon" variant="ghost" className="h-6 w-6">
            <Pencil className="h-3 w-3" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit purchase &amp; acquisition</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Purchase price (AUD)">
              <Input type="number" value={form.purchasePrice} onChange={(e) => setForm({ ...form, purchasePrice: e.target.value })} />
            </Field>
            <Field label="Estimated market value (AUD)">
              <Input type="number" value={form.currentValue} onChange={(e) => setForm({ ...form, currentValue: e.target.value })} />
            </Field>
            <Field label="Settlement date">
              <Input type="date" value={form.purchaseDate} onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })} />
            </Field>
            <Field label="Stamp duty (AUD)">
              <Input type="number" value={form.stampDuty} onChange={(e) => setForm({ ...form, stampDuty: e.target.value })} />
            </Field>
            <Field label="Deposit (AUD)">
              <Input type="number" value={form.deposit} onChange={(e) => setForm({ ...form, deposit: e.target.value })} />
            </Field>
            <Field label="Lot size">
              <Input value={form.lotSize} onChange={(e) => setForm({ ...form, lotSize: e.target.value })} placeholder="e.g. 450m²" />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Physical attributes">
                <Input
                  value={form.physicalAttributes}
                  onChange={(e) => setForm({ ...form, physicalAttributes: e.target.value })}
                  placeholder="e.g. 3 bed / 2 bath / 1 car"
                />
              </Field>
            </div>
          </div>

          <div className="rounded-md border p-3">
            <div className="mb-2 text-sm font-medium">Bank loan (optional)</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Lender name">
                <Input value={form.lender} onChange={(e) => setForm({ ...form, lender: e.target.value })} />
              </Field>
              <Field label="Loan account / reference">
                <Input value={form.loanAccountRef} onChange={(e) => setForm({ ...form, loanAccountRef: e.target.value })} />
              </Field>
              <Field label="Current loan balance (AUD)">
                <Input type="number" value={form.loanBalance} onChange={(e) => setForm({ ...form, loanBalance: e.target.value })} />
              </Field>
              <Field label="Interest rate (%)">
                <Input type="number" step="0.01" value={form.interestRate} onChange={(e) => setForm({ ...form, interestRate: e.target.value })} />
              </Field>
              <Field label="Repayment frequency">
                <Select value={form.repaymentFrequency} onValueChange={(v) => setForm({ ...form, repaymentFrequency: v as RepaymentFrequency })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Weekly">Weekly</SelectItem>
                    <SelectItem value="Fortnightly">Fortnightly</SelectItem>
                    <SelectItem value="Monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
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

export function PropertyPurchaseTab({ prop, loan }: { prop: Property; loan?: Loan }) {
  const { state } = useStore();
  const documents = buildDocumentEntries(state).filter(
    (e) => e.propertyId === prop.id && (e.kind === "Property Document" || e.kind === "Property Sale"),
  );
  return (
    <div className="space-y-4 text-sm">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">Acquisition and financing details for this property.</div>
        <PurchaseAcquisitionDialog prop={prop} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Purchase price" value={fmtCurrency(prop.purchasePrice)} />
        <Stat label="Current value" value={fmtCurrency(prop.currentValue)} />
        <Stat label="Settlement date" value={prop.purchaseDate || "—"} />
        <Stat label="Stamp duty" value={prop.stampDuty ? fmtCurrency(prop.stampDuty) : "—"} />
        <Stat label="Deposit" value={prop.deposit ? fmtCurrency(prop.deposit) : "—"} />
        <Stat label="Lot size" value={prop.lotSize || "—"} />
        <Stat label="Physical attributes" value={prop.physicalAttributes || "—"} />
        <Stat label="Lender" value={prop.lender || loan?.bankName || "—"} />
        <Stat label="Loan balance" value={fmtCurrency(prop.loanBalance ?? loan?.totalBalance ?? 0)} />
        <Stat label="Interest rate" value={prop.interestRate ? `${prop.interestRate}%` : "—"} />
        <Stat label="Monthly EMI" value={fmtCurrency(loan?.monthlyEmi ?? 0)} />
        <Stat label="Offset balance" value={loan?.offsetBalance ? fmtCurrency(loan.offsetBalance) : "—"} />
      </div>
      <DocumentsPanel title="Documents" entries={documents} />
    </div>
  );
}

export function PropertyCostBaseTab({ prop, expenses }: { prop: Property; expenses: Expense[]; depreciationItems: DepreciationItem[] }) {
  const [query, setQuery] = useState("");
  const capitalTx = expenses.filter((e) => e.taxCategory === "Capital Works");
  const capitalWorks = capitalTx.reduce((s, e) => s + e.cost, 0);
  const stampDuty = prop.stampDuty ?? 0;
  // Only used for the cost-base total and the purchase-vs-capital-works split below — every
  // on-screen "Purchase price" label shows prop.purchasePrice on its own, with stamp duty broken
  // out as its own line, instead of silently folding stamp duty into "purchase price".
  const purchaseCost = prop.purchasePrice + stampDuty;
  const costBase = purchaseCost + capitalWorks;

  const byCategory = capitalTx.reduce<Record<string, number>>((acc, e) => {
    acc[e.itemName] = (acc[e.itemName] ?? 0) + e.cost;
    return acc;
  }, {});
  const categoryEntries = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);

  const filtered = capitalTx
    .filter((e) => !query || e.itemName.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const purchasePct = costBase > 0 ? Math.round((purchaseCost / costBase) * 100) : 0;

  return (
    <div className="space-y-4 text-sm">
      <p className="text-xs text-muted-foreground">
        Estimate only — purchase price + stamp duty + capital-works transactions. Not adjusted for depreciation; talk
        to your accountant for the actual CGT cost base.
      </p>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Cost Base Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Stat label="Purchase price" value={fmtCurrency(prop.purchasePrice)} />
                <Stat label="Stamp duty" value={fmtCurrency(stampDuty)} />
                <Stat label="Capital costs" value={fmtCurrency(capitalWorks)} />
                <Stat label="Total cost base" value={fmtCurrency(costBase)} />
              </div>
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">Capital costs by category</div>
                {categoryEntries.length === 0 ? (
                  <div className="text-xs text-muted-foreground">No capital-works transactions logged yet.</div>
                ) : (
                  <div className="space-y-1">
                    {categoryEntries.map(([cat, amount]) => (
                      <div key={cat} className="flex items-center justify-between text-xs">
                        <span className="truncate text-muted-foreground">{cat}</span>
                        <span className="font-medium">{fmtCurrency(amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-base">Capital Transactions</CardTitle>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search transactions…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="h-8 w-[180px] pl-7 text-xs"
                />
              </div>
            </CardHeader>
            {filtered.length === 0 ? (
              <CardContent className="p-6 text-center text-xs text-muted-foreground">
                <Calculator className="mx-auto mb-2 h-6 w-6" />
                No capital transactions match.
              </CardContent>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Date</th>
                      <th className="px-3 py-2 font-medium">Description</th>
                      <th className="px-3 py-2 font-medium">Category</th>
                      <th className="px-3 py-2 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((e) => (
                      <tr key={e.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="whitespace-nowrap px-3 py-2 text-xs">{e.date}</td>
                        <td className="px-3 py-2 font-medium">{e.itemName}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{e.taxCategory}</td>
                        <td className="px-3 py-2 text-right font-medium">{fmtCurrency(e.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
              <span>{filtered.length} of {capitalTx.length} transactions</span>
              <span>
                Total <span className="font-medium text-foreground">{fmtCurrency(filtered.reduce((s, e) => s + e.cost, 0))}</span>
              </span>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Insights</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="text-muted-foreground">Purchase price</span>
                  <span className="font-medium">{purchasePct}%</span>
                </div>
                <Progress value={purchasePct} />
                <div className="mt-2 flex justify-between text-xs">
                  <span className="text-muted-foreground">Capital costs</span>
                  <span className="font-medium">{100 - purchasePct}%</span>
                </div>
              </div>
              <div className="border-t pt-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Purchase price</span>
                  <span className="font-medium">{fmtCurrency(prop.purchasePrice)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Stamp duty</span>
                  <span className="font-medium">{fmtCurrency(stampDuty)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Capital costs</span>
                  <span className="font-medium">{fmtCurrency(capitalWorks)}</span>
                </div>
                <div className="mt-1 flex justify-between border-t pt-1">
                  <span className="font-medium">Total cost base</span>
                  <span className="font-semibold">{fmtCurrency(costBase)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Capital by category</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {categoryEntries.length === 0 && <div className="text-xs text-muted-foreground">No capital costs yet.</div>}
              {categoryEntries.map(([cat, amount]) => (
                <div key={cat} className="flex items-center justify-between">
                  <span className="truncate text-muted-foreground">{cat}</span>
                  <span className="font-medium">{fmtCurrency(amount)}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function NewDepreciationItemDialog({ assetId, item, trigger }: { assetId?: string; item?: DepreciationItem; trigger?: React.ReactNode }) {
  const { addDepreciationItem, updateDepreciationItem } = useStore();
  const [open, setOpen] = useState(false);
  const isEdit = !!item;
  const [description, setDescription] = useState(item?.description ?? "");
  const [purchaseCost, setPurchaseCost] = useState(item ? String(item.purchaseCost) : "");
  const [effectiveLifeYears, setEffectiveLifeYears] = useState(item ? String(item.effectiveLifeYears) : "");
  const [purchaseDate, setPurchaseDate] = useState(item?.purchaseDate ?? todayISO());
  const [method, setMethod] = useState<NonNullable<DepreciationItem["method"]>>(item?.method ?? "Diminishing Value");
  const [division, setDivision] = useState<NonNullable<DepreciationItem["division"]>>(item?.division ?? "Div 40");

  // Looked up live off the name field, not just on blur — the "matched" feedback below should
  // track what's actually typed, even before the field loses focus.
  const atoMatch = lookupAtoEffectiveLife(description);
  const onDescriptionBlur = () => {
    if (effectiveLifeYears) return;
    if (atoMatch) setEffectiveLifeYears(String(atoMatch.years));
  };

  const onDivisionChange = (v: NonNullable<DepreciationItem["division"]>) => {
    setDivision(v);
    // Div 43 (capital works) is only ever claimable straight-line under ATO rules — unlike Div 40,
    // it has no diminishing-value option, same lock AddDepreciationReportDialog applies per row.
    if (v === "Div 43") setMethod("Prime Cost");
  };

  // Live preview of what this item will actually claim — same math as everywhere else
  // (itemAnnualClaims), not a separate estimate that could quietly disagree with it.
  const previewCost = parseFloat(purchaseCost) || 0;
  const previewLife = parseFloat(effectiveLifeYears) || 1;
  const previewClaims = previewCost > 0 ? itemAnnualClaims(previewCost, previewLife, method, purchaseDate || todayISO()) : [];

  const save = () => {
    if (!assetId) return;
    if (!description.trim()) return toast.error("Description required");
    const cost = parseFloat(purchaseCost);
    if (!cost || cost <= 0) return toast.error("Cost must be greater than 0");
    const payload = {
      assetId,
      description: description.trim(),
      purchaseCost: cost,
      effectiveLifeYears: parseFloat(effectiveLifeYears) || 1,
      purchaseDate: purchaseDate || undefined,
      method,
      division,
    };
    if (isEdit) updateDepreciationItem(item.id, payload);
    else addDepreciationItem(payload);
    toast.success(isEdit ? "Depreciation item updated" : "Depreciation item added");
    setOpen(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setDescription(item?.description ?? "");
          setPurchaseCost(item ? String(item.purchaseCost) : "");
          setEffectiveLifeYears(item ? String(item.effectiveLifeYears) : "");
          setPurchaseDate(item?.purchaseDate ?? todayISO());
          setMethod(item?.method ?? "Diminishing Value");
          setDivision(item?.division ?? "Div 40");
        }
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" variant="outline" className="gap-1">
            <Plus className="h-3 w-3" /> Add one-off item
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit depreciation item" : "New depreciation item"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Field label="Item name">
              <Input
                list="ato-effective-life-options"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={onDescriptionBlur}
                placeholder="Start typing to search the ATO list, or enter your own"
              />
              <datalist id="ato-effective-life-options">
                {ATO_EFFECTIVE_LIFE_LABELS.map((label) => (
                  <option key={label} value={label} />
                ))}
              </datalist>
            </Field>
            {atoMatch ? (
              <div className="mt-1 flex items-center gap-1 text-xs text-emerald-700">
                <CheckCircle2 className="h-3 w-3 shrink-0" />
                Matched ATO reference: {atoMatch.label} — {atoMatch.years} years
              </div>
            ) : (
              description.trim() && (
                <div className="mt-1 text-xs text-muted-foreground">No ATO reference found — enter the effective life manually.</div>
              )
            )}
          </div>
          <Field label="Cost">
            <Input type="number" value={purchaseCost} onChange={(e) => setPurchaseCost(e.target.value)} />
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
          <Field label="Division">
            <Select value={division} onValueChange={(v) => onDivisionChange(v as typeof division)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Div 40">Div 40 — Plant &amp; Equipment</SelectItem>
                <SelectItem value="Div 43">Div 43 — Capital Works</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Purchase date">
            <Input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">Removable items like appliances, carpets, blinds are usually Div 40; structural work is usually Div 43.</p>
        {previewClaims.length > 0 && (
          <div className="rounded-md border bg-muted/30 p-2 text-xs">
            <span className="font-medium">Estimated deduction — Year 1: {fmtCurrency(previewClaims[0])}</span>
            {previewClaims[1] !== undefined && <span className="text-muted-foreground"> · Year 2 onward: ~{fmtCurrency(previewClaims[1])}/yr</span>}
          </div>
        )}
        <DialogFooter>
          <Button onClick={save}>{isEdit ? "Save changes" : "Add item"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Per-item breakdown of `itemAnnualClaims`/`item.annualClaims` — the aggregate "Annual
 * Deductions" table on DepreciationTab sums every item together by financial year, which doesn't
 * answer "what does this one item claim, and when." Opened from a per-row action button instead
 * of being folded into the row itself, since the year-by-year figures only matter when actually
 * checking one item against its report. */
function DepreciationItemScheduleDialog({ item, trigger }: { item: DepreciationItem; trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const start = item.purchaseDate || item.effectiveFrom || todayISO();
  const startYear = parseInt(ausFinancialYear(start).split("-")[0], 10);
  const claims = item.annualClaims ?? itemAnnualClaims(item.purchaseCost, item.effectiveLifeYears, item.method ?? "Diminishing Value", start);
  const totalClaimed = claims.reduce((sum, c) => sum + c, 0);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="icon" variant="ghost" className="h-6 w-6" title="View schedule">
            <Eye className="h-3 w-3" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{item.description}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2 rounded border p-3 text-xs">
          <div>
            <div className="text-muted-foreground">Cost</div>
            <div className="font-medium">{fmtCurrency(item.purchaseCost)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Method</div>
            <div className="font-medium">{item.method ?? "Diminishing Value"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Division</div>
            <div className="font-medium">{item.division ?? "Div 40"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Effective life</div>
            <div className="font-medium">{item.effectiveLifeYears} years</div>
          </div>
        </div>
        {claims.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground">No schedule available for this item.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-1.5 pr-3 font-medium">Year</th>
                  <th className="py-1.5 pl-3 text-right font-medium">Claim</th>
                </tr>
              </thead>
              <tbody>
                {claims.map((c, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-1.5 pr-3">
                      FY {startYear + i}-{startYear + i + 1}
                    </td>
                    <td className="py-1.5 pl-3 text-right">{fmtCurrency(c)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="pt-1.5 pr-3 font-medium">Total</td>
                  <td className="pt-1.5 pl-3 text-right font-medium">{fmtCurrency(totalClaimed)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function DepreciationTab({ assetId }: { assetId?: string }) {
  const { state, deleteDepreciationItem } = useStore();
  const [editingReportId, setEditingReportId] = useState<string | null>(null);

  const items = assetId ? state.depreciationItems.filter((d) => d.assetId === assetId) : [];
  const schedule = buildDepreciationSchedule(items);
  const linkedPropertyId = state.assets.find((a) => a.id === assetId)?.linkedPropertyId;
  const documents = linkedPropertyId
    ? buildDocumentEntries(state).filter((e) => e.propertyId === linkedPropertyId && e.kind === "Depreciation Report")
    : [];

  // Items saved together via one "Add depreciation report" upload share one reportId — grouped
  // here so the whole report can be reopened and edited as the bundle it actually is (its saved
  // annualClaims/reportAnnualSummary only make sense read back together), rather than one item at
  // a time. A one-off item (no reportId) has no such bundle to preserve, so it keeps its own
  // direct edit/delete instead.
  const reportGroups = new Map<string, DepreciationItem[]>();
  const oneOffItems: DepreciationItem[] = [];
  for (const d of items) {
    if (d.reportId) reportGroups.set(d.reportId, [...(reportGroups.get(d.reportId) ?? []), d]);
    else oneOffItems.push(d);
  }
  const editingReportItems = editingReportId ? items.filter((d) => d.reportId === editingReportId) : undefined;

  // editTrigger is a whole rendered element (a NewDepreciationItemDialog with its own Pencil-icon
  // trigger), not a plain callback — editing a one-off item opens its own dialog, unlike deleting.
  const itemRow = (d: DepreciationItem, editTrigger?: React.ReactNode, showQsBadge = true) => (
    <div key={d.id} className="flex items-center justify-between rounded border p-2 text-xs">
      <div>
        <div className="flex items-center gap-1.5 font-medium">
          {d.description}
          {d.division && <Badge variant="outline" className="text-[10px]">{d.division}</Badge>}
          {showQsBadge && d.quantitySurveyor && <Badge variant="secondary" className="text-[10px]">{d.quantitySurveyor}</Badge>}
        </div>
        <div className="text-muted-foreground">
          {fmtCurrency(d.purchaseCost)} over {d.effectiveLifeYears}y · {d.method ?? "Diminishing Value"}
        </div>
      </div>
      <div className="flex items-center gap-1">
        <DepreciationItemScheduleDialog item={d} />
        {editTrigger}
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          title="Delete"
          onClick={() => {
            deleteDepreciationItem(d.id);
            toast.success("Removed");
          }}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4 text-sm">
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-medium">Item Details</div>
              <div className="text-xs text-muted-foreground">{items.length} individual item{items.length === 1 ? "" : "s"} tracked</div>
            </div>
            <div className="flex gap-2">
              <AddDepreciationReportDialog assetId={assetId} />
              <NewDepreciationItemDialog assetId={assetId} />
            </div>
          </div>
          {items.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground">
              No depreciation yet — add a quantity surveyor report, or smaller items manually, to start tracking deductions.
            </div>
          ) : (
            <div className="space-y-3">
              {Array.from(reportGroups.entries()).map(([reportId, group]) => {
                const first = group[0];
                return (
                  <div key={reportId} className="space-y-1.5 rounded-md border p-2">
                    <div className="flex items-center justify-between gap-2 border-b pb-1.5">
                      <div className="flex items-center gap-1.5 text-xs font-medium">
                        {first.quantitySurveyor || first.reportReference || "Depreciation report"}
                        {first.reportDate && <span className="font-normal text-muted-foreground">· {first.reportDate}</span>}
                        <Badge variant="outline" className="text-[10px]">
                          {group.length} item{group.length === 1 ? "" : "s"}
                        </Badge>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 gap-1 text-xs"
                        title="Edit report"
                        onClick={() => setEditingReportId(reportId)}
                      >
                        <Pencil className="h-3 w-3" /> Edit report
                      </Button>
                    </div>
                    <div className="space-y-1">{group.map((d) => itemRow(d, undefined, false))}</div>
                  </div>
                );
              })}
              {oneOffItems.map((d) =>
                itemRow(
                  d,
                  <NewDepreciationItemDialog
                    key={`edit-${d.id}`}
                    assetId={assetId}
                    item={d}
                    trigger={
                      <Button size="icon" variant="ghost" className="h-6 w-6" title="Edit">
                        <Pencil className="h-3 w-3" />
                      </Button>
                    }
                  />,
                ),
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {editingReportItems && editingReportItems.length > 0 && (
        <AddDepreciationReportDialog
          assetId={assetId}
          report={editingReportItems}
          open={!!editingReportId}
          onOpenChange={(o) => {
            if (!o) setEditingReportId(null);
          }}
        />
      )}

      <Card>
        <CardContent className="space-y-2 p-4">
          <div>
            <div className="text-sm font-medium">Annual Deductions</div>
            <div className="text-xs text-muted-foreground">Division totals by financial year — a simplified projection, not tax advice.</div>
          </div>
          {schedule.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground">No annual schedule yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-1.5 pr-3 font-medium">Year</th>
                    <th className="py-1.5 px-3 text-right font-medium">Div 40</th>
                    <th className="py-1.5 px-3 text-right font-medium">Div 43</th>
                    <th className="py-1.5 pl-3 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {schedule.map((y) => (
                    <tr key={y.fy} className="border-b last:border-0">
                      <td className="py-1.5 pr-3">FY {y.fy}</td>
                      <td className="py-1.5 px-3 text-right">{fmtCurrency(y.div40)}</td>
                      <td className="py-1.5 px-3 text-right">{fmtCurrency(y.div43)}</td>
                      <td className="py-1.5 pl-3 text-right font-medium">{fmtCurrency(y.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <DocumentsSection title="Documents" entries={documents} />
    </div>
  );
}

function currentFiguresFormOf(prop: Property) {
  return {
    pmFeePercent: prop.pmFeePercent?.toString() ?? "",
    councilRatesAnnual: prop.councilRatesAnnual?.toString() ?? "",
    waterRatesAnnual: prop.waterRatesAnnual?.toString() ?? "",
    insuranceAnnual: prop.insuranceAnnual?.toString() ?? "",
    strataFeesAnnual: prop.strataFeesAnnual?.toString() ?? "",
    landTaxAnnual: prop.landTaxAnnual?.toString() ?? "",
    repairsMaintenanceAnnual: prop.repairsMaintenanceAnnual?.toString() ?? "",
  };
}

/**
 * The known-fixed-cost inputs that feed the Annual Forecast card on the P&L tab — one dedicated,
 * always-editable place to review/correct them, rather than only reachable through the smaller
 * "Edit property details" dialog. Confirming an AI-read bill (Council Rates, Water, Strata, Land
 * Tax, or a no-instalment Insurance invoice) through Add Bill already writes its matching field
 * here automatically (see ANNUAL_COST_FIELD in AddBillDialog) — this page is where that
 * auto-filled figure shows up, and where it can be corrected or filled in by hand. Repairs &
 * Maintenance has no bill type of its own to auto-fill from (repairs are one-off, not a recurring
 * annual bill), so its field always needs a manual figure — the "Logged this FY" hint below every
 * field (sourced from actual Expense rows, not just bills) is the closest thing it gets to an
 * auto-fill, and doubles as a sanity check for the other fields too.
 */
export function PropertyCurrentFiguresTab({ prop, tenants }: { prop: Property; tenants: Tenant[] }) {
  const { state, updateProperty } = useStore();
  const [form, setForm] = useState(() => currentFiguresFormOf(prop));
  const currentFY = ausFinancialYear(todayISO());
  const { start: fyStart, end: fyEnd } = fyRange(currentFY);

  const activeTenant = tenants.find((t) => !t.leaseExpiry || t.leaseExpiry >= todayISO());
  const weeklyRent =
    activeTenant &&
    (activeTenant.rentFrequency === "Weekly"
      ? activeTenant.rentAmount
      : activeTenant.rentFrequency === "Fortnightly"
        ? activeTenant.rentAmount / 2
        : (activeTenant.rentAmount * 12) / 52);
  const annualRent = weeklyRent ? weeklyRent * 52 : 0;

  const pmFeePercent = parseFloat(form.pmFeePercent) || 0;
  const annualPmCost = (annualRent * pmFeePercent) / 100;

  const expenseFields: { key: keyof typeof form; label: string; expenseCategory: ExpenseCategory }[] = [
    { key: "councilRatesAnnual", label: "Council Rates ($)", expenseCategory: "Council Rates" },
    { key: "waterRatesAnnual", label: "Water Rates ($)", expenseCategory: "Water Charges" },
    { key: "insuranceAnnual", label: "Insurance ($)", expenseCategory: "Insurance" },
    { key: "strataFeesAnnual", label: "Strata / Body Corp ($)", expenseCategory: "Strata Levies" },
    { key: "landTaxAnnual", label: "Land Tax ($)", expenseCategory: "Land Tax" },
    { key: "repairsMaintenanceAnnual", label: "Repairs & Maintenance ($)", expenseCategory: "Repairs & Maintenance" },
  ];
  const totalAnnualExpenses = expenseFields.reduce((s, f) => s + (parseFloat(form[f.key]) || 0), 0);

  // What's actually been logged this FY under the matching category — Council Rates/Water/
  // Strata/Insurance/Land Tax also auto-fill their field above the moment a matching AI-read bill
  // is confirmed (ANNUAL_COST_FIELD in AddBillDialog), but Repairs & Maintenance never gets a
  // single "annual" figure that way since repairs are one-off, not a recurring bill — this total
  // is the only way to see what's actually been spent under it, for every field alike.
  const loggedThisFy = (category: ExpenseCategory) =>
    state.expenses
      .filter((e) => e.propertyId === prop.id && e.category === category && e.direction !== "Income" && e.date >= fyStart && e.date <= fyEnd)
      .reduce((s, e) => s + e.cost, 0);

  const save = () => {
    updateProperty(prop.id, {
      pmFeePercent: form.pmFeePercent ? parseFloat(form.pmFeePercent) : undefined,
      councilRatesAnnual: form.councilRatesAnnual ? parseFloat(form.councilRatesAnnual) : undefined,
      waterRatesAnnual: form.waterRatesAnnual ? parseFloat(form.waterRatesAnnual) : undefined,
      insuranceAnnual: form.insuranceAnnual ? parseFloat(form.insuranceAnnual) : undefined,
      strataFeesAnnual: form.strataFeesAnnual ? parseFloat(form.strataFeesAnnual) : undefined,
      landTaxAnnual: form.landTaxAnnual ? parseFloat(form.landTaxAnnual) : undefined,
      repairsMaintenanceAnnual: form.repairsMaintenanceAnnual ? parseFloat(form.repairsMaintenanceAnnual) : undefined,
    });
    toast.success("Current figures saved");
  };

  return (
    <div className="space-y-4 text-sm">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Current Figures</CardTitle>
          <div className="text-xs text-muted-foreground">
            Annual costs used for the P&L Annual Forecast — confirming a matching AI-read bill (Council Rates, Water,
            Strata, Insurance, Land Tax) fills these in automatically, and they're always editable here too. Every field
            also shows what's actually been logged this FY under its category — click it to use that figure.
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <div className="text-xs font-medium">Rental Income</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Weekly rent (from current tenancy)">
                <div className="flex h-9 items-center rounded-md border bg-muted/30 px-3 text-sm text-muted-foreground">
                  {weeklyRent ? fmtCurrency(weeklyRent) : "Not set — add a tenant under Tenancy"}
                </div>
              </Field>
              <Field label="Annual rent">
                <div className="flex h-9 items-center rounded-md border bg-muted/30 px-3 text-sm font-medium">{fmtCurrency(annualRent)}</div>
              </Field>
            </div>
          </div>

          <div className="space-y-2 border-t pt-4">
            <div className="text-xs font-medium">Property Management</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="PM fee rate (%)">
                <Input
                  type="number"
                  value={form.pmFeePercent}
                  onChange={(e) => setForm((f) => ({ ...f, pmFeePercent: e.target.value }))}
                />
              </Field>
              <Field label="Annual PM cost">
                <div className="flex h-9 items-center rounded-md border bg-muted/30 px-3 text-sm font-medium">{fmtCurrency(annualPmCost)}</div>
              </Field>
            </div>
          </div>

          <div className="space-y-2 border-t pt-4">
            <div className="text-xs font-medium">Annual Expenses</div>
            <div className="grid gap-3 sm:grid-cols-2">
              {expenseFields.map((f) => {
                const logged = loggedThisFy(f.expenseCategory);
                return (
                  <Field key={f.key} label={f.label}>
                    <Input type="number" value={form[f.key]} onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))} />
                    {logged > 0 && (
                      <button
                        type="button"
                        className="mt-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
                        title={`Set to what's logged this FY under "${f.expenseCategory}"`}
                        onClick={() => setForm((prev) => ({ ...prev, [f.key]: String(logged) }))}
                      >
                        Logged this FY: {fmtCurrency(logged)}
                      </button>
                    )}
                  </Field>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between border-t pt-4">
            <div>
              <div className="text-xs text-muted-foreground">Total annual expenses</div>
              <div className="text-lg font-semibold text-destructive">{fmtCurrency(totalAnnualExpenses)}</div>
            </div>
            <Button onClick={save}>Save Figures</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Current-year baseline figures from known fixed costs (Property's own annual-cost fields, the
 * current loan, current tenants' rent) — not YTD actuals, not a prediction of rent changes,
 * vacancies or rate rises. Shared by the P&L tab's "Annual Forecast" card and the Forecasts tab's
 * year-0 starting point, so the two always agree on today's numbers.
 */
function computeAnnualBaseline(prop: Property, loan: Loan | undefined, tenants: Tenant[]) {
  const activeTenants = tenants.filter((t) => !t.leaseExpiry || t.leaseExpiry >= todayISO());
  const annualRent = activeTenants.reduce(
    (s, t) => s + (t.rentFrequency === "Weekly" ? t.rentAmount * 52 : t.rentFrequency === "Fortnightly" ? t.rentAmount * 26 : t.rentAmount * 12),
    0,
  );
  const opExLines: [string, number][] = (
    [
      ["Council rates", prop.councilRatesAnnual ?? 0],
      ["Water rates", prop.waterRatesAnnual ?? 0],
      ["Insurance", prop.insuranceAnnual ?? 0],
      ["Strata fees", prop.strataFeesAnnual ?? 0],
      ["Land tax", prop.landTaxAnnual ?? 0],
      ["Repairs & maintenance (est.)", prop.repairsMaintenanceAnnual ?? 0],
    ] as [string, number][]
  ).filter(([, amount]) => amount > 0);
  const pmFee = prop.pmFeePercent ? (annualRent * prop.pmFeePercent) / 100 : 0;
  if (prop.pmFeePercent) opExLines.push(["Property management fee (est.)", pmFee]);
  const opEx = opExLines.reduce((s, [, amount]) => s + amount, 0);

  const annualInterest = loan ? (loan.totalBalance * loan.interestRate) / 100 : 0;
  const annualEmiTotal = loan ? loan.monthlyEmi * 12 : 0;
  const annualPrincipal = loan && loan.loanType !== "Interest Only" ? Math.max(0, annualEmiTotal - annualInterest) : 0;
  const totalLoanRepayments = loan ? annualInterest + annualPrincipal : 0;

  const netCashflow = annualRent - opEx - totalLoanRepayments;

  return { annualRent, opExLines, opEx, pmFee, annualInterest, annualPrincipal, totalLoanRepayments, netCashflow };
}

export function PropertyPnLTab({ prop, loan, tenants, expenses }: { prop: Property; loan?: Loan; tenants: Tenant[]; expenses: Expense[] }) {
  const { state } = useStore();
  const currentFY = ausFinancialYear(todayISO());
  const [fy, setFy] = useState(currentFY);
  // Most recent first, capped to years up to the current one — a future FY tab has nothing to show.
  const fyOptions = useMemo(() => buildFyOptions(7).filter((y) => y <= currentFY).reverse(), [currentFY]);
  const isCurrentFY = fy === currentFY;
  const { start, end: fyEnd } = fyRange(fy);
  // The current FY isn't over yet — showing it as year-to-date (rather than projecting a full
  // year that hasn't happened) matches how a landlord actually reads "where do I stand right now".
  const end = isCurrentFY ? todayISO() : fyEnd;

  const tenantIds = tenants.map((t) => t.id);
  const rentEntries = state.ledger.filter(
    (e) => tenantIds.includes(e.tenantId) && e.type === "Rent Payment" && e.date >= start && e.date <= end,
  );
  const grossRent = rentEntries.reduce((s, e) => s + e.credit, 0);

  const periodExpenses = expenses.filter((e) => e.date >= start && e.date <= end);
  const outgoing = periodExpenses.filter((e) => e.direction !== "Income");
  const extraIncome = periodExpenses.filter((e) => e.direction === "Income");

  const incomeByCategory: Record<string, number> = { "Gross Rent": grossRent };
  for (const e of extraIncome) {
    const cat = e.category ?? "Other Income";
    incomeByCategory[cat] = (incomeByCategory[cat] ?? 0) + e.cost;
  }
  const incomeLines = Object.entries(incomeByCategory)
    .filter(([, amount]) => amount !== 0)
    .sort((a, b) => b[1] - a[1]);
  const totalIncome = incomeLines.reduce((s, [, amount]) => s + amount, 0);

  const expenseByCategory: Record<string, number> = {};
  for (const e of outgoing) {
    const cat = e.category ?? "Other";
    expenseByCategory[cat] = (expenseByCategory[cat] ?? 0) + e.cost;
  }
  const loanInterest = loan ? (((loan.totalBalance * loan.interestRate) / 100) * daysInclusive(start, end)) / 365 : 0;
  if (loanInterest > 0) expenseByCategory["Loan Interest (est.)"] = loanInterest;
  const expenseLines = Object.entries(expenseByCategory).sort((a, b) => b[1] - a[1]);
  const totalExpenses = expenseLines.reduce((s, [, amount]) => s + amount, 0);
  const maxExpense = Math.max(0, ...expenseLines.map(([, amount]) => amount));

  const netCashflow = totalIncome - totalExpenses;
  const transactionCount = rentEntries.length + outgoing.length + extraIncome.length;

  // Annual Forecast — a separate, full-year projection from known fixed costs (Property's own
  // annual-cost fields, the current loan, the current tenant's rent), not the YTD actuals above.
  // Only meaningful for the year still in progress; a closed past FY has actuals, not a forecast.
  const {
    annualRent: forecastAnnualRent,
    opExLines: forecastOpExLines,
    opEx: forecastOpEx,
    annualInterest: forecastAnnualInterest,
    annualPrincipal: forecastAnnualPrincipal,
    totalLoanRepayments: forecastTotalLoanRepayments,
    netCashflow: forecastCashflow,
  } = computeAnnualBaseline(prop, loan, tenants);

  const depreciationItems = state.depreciationItems.filter((d) => d.assetId === prop.assetId);
  const forecastDepreciation = buildDepreciationSchedule(depreciationItems).find((s) => s.fy === currentFY)?.total ?? 0;

  const forecastNetIncome = forecastAnnualRent - forecastOpEx - forecastAnnualInterest;
  const forecastTaxableResult = forecastNetIncome - forecastDepreciation;

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap gap-1.5">
        {fyOptions.map((y) => (
          <Button key={y} size="sm" variant={fy === y ? "default" : "outline"} className="h-7 px-2.5 text-xs" onClick={() => setFy(y)}>
            FY {y}
            {y === currentFY ? " · YTD" : ""}
          </Button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Profit &amp; Loss — FY {fy}
              {isCurrentFY ? " YTD" : ""}
            </CardTitle>
            <div className="text-xs text-muted-foreground">
              {start} to {end} · {transactionCount} transaction{transactionCount === 1 ? "" : "s"}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <div className="text-xs font-medium text-emerald-600">Income</div>
              {incomeLines.length === 0 && <div className="text-xs text-muted-foreground">No income in this period.</div>}
              {incomeLines.map(([label, amount]) => (
                <div key={label} className="flex justify-between">
                  <span>{label}</span>
                  <span>{fmtCurrency(amount)}</span>
                </div>
              ))}
              <div className="flex justify-between border-t pt-1 font-medium">
                <span>Total Income</span>
                <span>{fmtCurrency(totalIncome)}</span>
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-xs font-medium text-destructive">Expenses</div>
              {expenseLines.length === 0 && <div className="text-xs text-muted-foreground">No expenses in this period.</div>}
              {expenseLines.map(([label, amount]) => (
                <div key={label} className="flex justify-between">
                  <span>{label}</span>
                  <span>{fmtCurrency(amount)}</span>
                </div>
              ))}
              <div className="flex justify-between border-t pt-1 font-medium">
                <span>Total Expenses</span>
                <span>{fmtCurrency(totalExpenses)}</span>
              </div>
            </div>

            <div className="space-y-0.5 border-t pt-2">
              <div className="flex items-center justify-between text-base font-semibold">
                <span>Net Cashflow</span>
                <span className={netCashflow < 0 ? "text-destructive" : "text-emerald-600"}>
                  {netCashflow < 0 ? "−" : ""}
                  {fmtCurrency(Math.abs(netCashflow))}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">Income − cash expenses; depreciation excluded</div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Profit &amp; loss</CardTitle>
              <div className="text-xs text-muted-foreground">
                FY {fy}
                {isCurrentFY ? " YTD" : ""}
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <div>
                <div className={"text-lg font-semibold " + (netCashflow < 0 ? "text-destructive" : "text-emerald-600")}>
                  {fmtCurrency(netCashflow)}
                </div>
                <div className="text-xs text-muted-foreground">net cashflow</div>
              </div>
              <div className="space-y-1 border-t pt-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Income</span>
                  <span className="font-medium text-emerald-600">{fmtCurrency(totalIncome)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Expenses</span>
                  <span className="font-medium text-destructive">{fmtCurrency(totalExpenses)}</span>
                </div>
                <div className="flex justify-between border-t pt-1">
                  <span className="text-muted-foreground">Taxable position</span>
                  <span className="font-medium">{fmtCurrency(netCashflow)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Where it goes</CardTitle>
              <div className="text-xs text-muted-foreground">Expenses by category</div>
            </CardHeader>
            <CardContent className="space-y-2">
              {expenseLines.length === 0 && <div className="text-xs text-muted-foreground">No expenses in this period.</div>}
              {expenseLines.map(([label, amount]) => (
                <div key={label} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-medium">{fmtCurrency(amount)}</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-muted">
                    <div
                      className="h-1.5 rounded-full bg-destructive"
                      style={{ width: `${maxExpense > 0 ? (amount / maxExpense) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      {isCurrentFY && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Annual Forecast — FY {fy}</CardTitle>
            <div className="text-xs text-muted-foreground">
              Projected full-year figures from known fixed costs — current rent, the property's own annual-cost fields, and the
              current loan. Not the YTD actuals above, and not a prediction of rent changes, vacancies or rate rises.
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-3">
                <div className="space-y-1">
                  <div className="text-xs font-medium text-emerald-600">Income</div>
                  <div className="flex justify-between">
                    <span>{forecastAnnualRent > 0 ? "Rental income" : "Rental income (not set)"}</span>
                    <span>{fmtCurrency(forecastAnnualRent)}</span>
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="text-xs font-medium text-destructive">Operating expenses</div>
                  {forecastOpExLines.length === 0 && (
                    <div className="text-xs text-muted-foreground">No annual cost fields set — add them under Details.</div>
                  )}
                  {forecastOpExLines.map(([label, amount]) => (
                    <div key={label} className="flex justify-between">
                      <span>{label}</span>
                      <span>{fmtCurrency(amount)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between border-t pt-1 font-medium">
                    <span>Total operating expenses</span>
                    <span>{fmtCurrency(forecastOpEx)}</span>
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="text-xs font-medium">Depreciation</div>
                  {depreciationItems.length === 0 && <div className="text-xs text-muted-foreground">No depreciation schedule set up.</div>}
                  <div className="flex justify-between border-t pt-1 font-medium">
                    <span>Total depreciation</span>
                    <span>{fmtCurrency(forecastDepreciation)}</span>
                  </div>
                </div>

                {loan && (
                  <div className="space-y-1">
                    <div className="text-xs font-medium">Loan repayments</div>
                    <div className="flex justify-between">
                      <span>Interest ({loan.bankName})</span>
                      <span>{fmtCurrency(forecastAnnualInterest)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Principal</span>
                      <span>{fmtCurrency(forecastAnnualPrincipal)}</span>
                    </div>
                    <div className="flex justify-between border-t pt-1 font-medium">
                      <span>Total loan repayments</span>
                      <span>{fmtCurrency(forecastTotalLoanRepayments)}</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-2 self-start rounded-md bg-muted/30 p-3">
                <div>
                  <div className="flex items-center justify-between font-medium">
                    <span>Net income (annual)</span>
                    <span className={forecastNetIncome < 0 ? "text-destructive" : "text-emerald-600"}>{fmtCurrency(forecastNetIncome)}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">Income − operating expenses − loan interest; depreciation excluded</div>
                </div>
                <div>
                  <div className="flex items-center justify-between font-medium">
                    <span>Cashflow (annual)</span>
                    <span className={forecastCashflow < 0 ? "text-destructive" : "text-emerald-600"}>{fmtCurrency(forecastCashflow)}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Income − operating expenses − loan repayments (interest and principal); depreciation excluded
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between font-medium">
                    <span>Taxable rental result (annual)</span>
                    <span className={forecastTaxableResult < 0 ? "text-destructive" : "text-emerald-600"}>{fmtCurrency(forecastTaxableResult)}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Net income − depreciation; principal paydown isn't claimable. The dollar tax impact depends on your other
                    income and rate — your accountant applies this to your return.
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Button asChild size="sm" variant="outline" className="gap-1">
        <Link to="/transactions">
          Full EOFY report <ArrowRight className="h-3 w-3" />
        </Link>
      </Button>
    </div>
  );
}

const FORECAST_YEARS = 40;

function fmtWhole(n: number): string {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(n);
}

function fmtAxisDollars(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}m`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1000)}k`;
  return `${sign}$${Math.round(abs)}`;
}

function forecastAssumptionsDefaults(prop: Property, loan?: Loan) {
  return {
    rentGrowth: "3",
    expenseGrowth: "3",
    capitalGrowth: "3",
    avgLoanInterest: (loan?.interestRate ?? prop.interestRate ?? 5.85).toString(),
    pmFeePercent: (prop.pmFeePercent ?? 6).toString(),
  };
}

/** Implied historical trend average growth (CAGR) in property value since purchase — what the
 * "Refresh HTAG" button offers as a data-backed alternative to guessing a capital growth rate. */
function historicalTrendAverageGrowth(prop: Property): number | null {
  if (!prop.purchasePrice || !prop.purchaseDate || !prop.currentValue) return null;
  const years = (Date.now() - new Date(prop.purchaseDate).getTime()) / (365.25 * 24 * 3600 * 1000);
  if (years < 0.5) return null;
  return (Math.pow(prop.currentValue / prop.purchasePrice, 1 / years) - 1) * 100;
}

/** Simple annual amortization of a loan at an assumed rate over its remaining term. Interest-only
 * loans never reduce principal; principal & interest loans use a standard annuity payment. */
function projectLoanBalance(openingBalance: number, ratePct: number, termYears: number, interestOnly: boolean, years: number) {
  const r = ratePct / 100;
  const n = Math.max(termYears, 1);
  const annualPayment = r === 0 ? openingBalance / n : (openingBalance * r) / (1 - Math.pow(1 + r, -n));
  const balances = [openingBalance];
  const repayments = [0];
  let balance = openingBalance;
  for (let i = 1; i <= years; i++) {
    const interest = balance * r;
    const payment = balance <= 0 ? 0 : interestOnly ? interest : Math.min(annualPayment, balance + interest);
    const principal = interestOnly ? 0 : Math.max(payment - interest, 0);
    balance = Math.max(balance - principal, 0);
    balances.push(balance);
    repayments.push(payment);
  }
  return { balances, repayments };
}

function buildForecast(
  prop: Property,
  loan: Loan | undefined,
  tenants: Tenant[],
  assumptions: { rentGrowth: number; expenseGrowth: number; capitalGrowth: number; avgLoanInterest: number; pmFeePercent: number },
) {
  const baseline = computeAnnualBaseline(prop, loan, tenants);
  const baseOpEx = baseline.opEx - baseline.pmFee;
  const openingBalance = loan?.totalBalance ?? 0;
  const remainingTermYears = loan?.maturityDate
    ? Math.max(1, Math.round((new Date(loan.maturityDate).getTime() - Date.now()) / (365.25 * 24 * 3600 * 1000)))
    : 30;
  const interestOnly = loan?.loanType === "Interest Only";
  const { balances: debtByYear, repayments: loanRepaymentsByYear } = projectLoanBalance(
    openingBalance,
    assumptions.avgLoanInterest,
    remainingTermYears,
    interestOnly,
    FORECAST_YEARS,
  );

  const rentGrowth = assumptions.rentGrowth / 100;
  const expenseGrowth = assumptions.expenseGrowth / 100;
  const capitalGrowth = assumptions.capitalGrowth / 100;
  const pmFeeRate = assumptions.pmFeePercent / 100;

  const rows: {
    year: number;
    propertyValue: number;
    debt: number;
    rent: number;
    expenses: number;
    netCF: number;
    cumulativeCF: number;
  }[] = [];
  let cumulativeCF = 0;
  for (let i = 0; i <= FORECAST_YEARS; i++) {
    const rent = baseline.annualRent * Math.pow(1 + rentGrowth, i);
    const pmFee = rent * pmFeeRate;
    const opEx = baseOpEx * Math.pow(1 + expenseGrowth, i);
    const expenses = pmFee + opEx + loanRepaymentsByYear[i];
    const netCF = rent - expenses;
    cumulativeCF += netCF;
    rows.push({
      year: i,
      propertyValue: prop.currentValue * Math.pow(1 + capitalGrowth, i),
      debt: debtByYear[i],
      rent,
      expenses,
      netCF,
      cumulativeCF,
    });
  }

  let cashflowNeutralYear: number | null = null;
  for (const row of rows) {
    if (row.netCF >= 0) {
      cashflowNeutralYear = row.year;
      break;
    }
  }
  if (cashflowNeutralYear === null) {
    const last = rows[rows.length - 1];
    const prev = rows[rows.length - 6];
    const trendPerYear = (last.netCF - prev.netCF) / (last.year - prev.year);
    if (trendPerYear > 0) {
      cashflowNeutralYear = last.year + Math.max(1, Math.ceil(-last.netCF / trendPerYear));
    }
  }

  return { rows, cashflowNeutralYear, openingBalance };
}

const FORECAST_CHART_CONFIG: ChartConfig = {
  propertyValue: { label: "Property value", color: "var(--primary)" },
  debt: { label: "Debt", color: "var(--muted-foreground)" },
  netCF: { label: "Net CF /yr", color: "var(--chart-3)" },
  cumulativeCF: { label: "Cumulative CF", color: "var(--primary)" },
  expenses: { label: "Expenses", color: "var(--destructive)" },
};

export function PropertyForecastsTab({ prop, loan, tenants }: { prop: Property; loan?: Loan; tenants: Tenant[] }) {
  const [form, setForm] = useState(() => forecastAssumptionsDefaults(prop, loan));

  const assumptions = {
    rentGrowth: parseFloat(form.rentGrowth) || 0,
    expenseGrowth: parseFloat(form.expenseGrowth) || 0,
    capitalGrowth: parseFloat(form.capitalGrowth) || 0,
    avgLoanInterest: parseFloat(form.avgLoanInterest) || 0,
    pmFeePercent: parseFloat(form.pmFeePercent) || 0,
  };

  const { rows, cashflowNeutralYear, openingBalance } = useMemo(
    () => buildForecast(prop, loan, tenants, assumptions),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prop, loan, tenants, form.rentGrowth, form.expenseGrowth, form.capitalGrowth, form.avgLoanInterest, form.pmFeePercent],
  );

  const year0 = rows[0];
  const year40 = rows[FORECAST_YEARS];
  const valueGrowth = year40.propertyValue - prop.currentValue;
  const valueGrowthPct = prop.currentValue ? (valueGrowth / prop.currentValue) * 100 : 0;
  const debtPaidOff = openingBalance - year40.debt;

  const refreshHtag = () => {
    const rate = historicalTrendAverageGrowth(prop);
    if (rate === null) {
      toast.error("Add a purchase price, purchase date and current value under Property Details to calculate historical growth");
      return;
    }
    setForm((f) => ({ ...f, capitalGrowth: rate.toFixed(1) }));
    toast.success(`Capital growth set to ${rate.toFixed(1)}% p.a. — this property's own trend since purchase`);
  };

  const resetTo3 = () => setForm((f) => ({ ...f, rentGrowth: "3", expenseGrowth: "3", capitalGrowth: "3" }));

  const milestoneYears = [10, 20, 30, 40];
  const chartTicks = [0, 5, 10, 15, 20, 25, 30, 35, 40];

  return (
    <div className="space-y-4 text-sm">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <CardTitle className="text-base">Forecast Assumptions</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="gap-1" onClick={refreshHtag}>
              <RefreshCw className="h-3.5 w-3.5" /> Refresh HTAG
            </Button>
            <Button size="sm" variant="outline" className="gap-1" onClick={resetTo3}>
              <History className="h-3.5 w-3.5" /> Reset to 3%
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Rent Growth (% p.a.)">
              <Input type="number" value={form.rentGrowth} onChange={(e) => setForm((f) => ({ ...f, rentGrowth: e.target.value }))} />
            </Field>
            <Field label="Expense Growth (% p.a.)">
              <Input type="number" value={form.expenseGrowth} onChange={(e) => setForm((f) => ({ ...f, expenseGrowth: e.target.value }))} />
            </Field>
            <Field label="Capital Growth (% p.a.)">
              <Input type="number" value={form.capitalGrowth} onChange={(e) => setForm((f) => ({ ...f, capitalGrowth: e.target.value }))} />
            </Field>
            <Field label="Avg Loan Interest (%)">
              <Input type="number" value={form.avgLoanInterest} onChange={(e) => setForm((f) => ({ ...f, avgLoanInterest: e.target.value }))} />
            </Field>
            <Field label="PM Fee (% of rent)">
              <Input type="number" value={form.pmFeePercent} onChange={(e) => setForm((f) => ({ ...f, pmFeePercent: e.target.value }))} />
            </Field>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Cashflow Neutral</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold text-emerald-600">
              {cashflowNeutralYear === null ? "Not projected" : cashflowNeutralYear === 0 ? "Already positive" : `Year ${cashflowNeutralYear}`}
            </div>
            <div className="text-xs text-muted-foreground">
              {cashflowNeutralYear !== null && cashflowNeutralYear > FORECAST_YEARS
                ? `Beyond the ${FORECAST_YEARS}-year chart · `
                : ""}
              Current annual cashflow: {fmtWhole(year0.netCF)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Property Value (Year {FORECAST_YEARS})</CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{fmtWhole(year40.propertyValue)}</div>
            <div className="text-xs text-muted-foreground">
              +{fmtWhole(valueGrowth)} ({valueGrowthPct.toFixed(1)}%)
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Debt at Year {FORECAST_YEARS}</CardTitle>
            <Landmark className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold text-destructive">{fmtWhole(year40.debt)}</div>
            <div className="text-xs text-muted-foreground">
              {openingBalance > 0 ? `${fmtWhole(debtPaidOff)} paid off` : "No loan on this property"}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{FORECAST_YEARS}-Year Investment Forecast</CardTitle>
          <div className="text-xs text-muted-foreground">Projected property value, debt, expenses and cumulative cashflow</div>
        </CardHeader>
        <CardContent>
          <ChartContainer config={FORECAST_CHART_CONFIG} className="aspect-auto h-[340px] w-full">
            <ComposedChart data={rows} margin={{ left: 4, right: 4, top: 4, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis
                dataKey="year"
                tickLine={false}
                axisLine={false}
                fontSize={11}
                ticks={chartTicks}
                tickFormatter={(y: number) => `Yr ${y}`}
              />
              <YAxis
                yAxisId="left"
                tickLine={false}
                axisLine={false}
                fontSize={11}
                width={56}
                tickFormatter={fmtAxisDollars}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tickLine={false}
                axisLine={false}
                fontSize={11}
                width={56}
                tickFormatter={fmtAxisDollars}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(y) => `Yr ${y}`}
                    formatter={(value, name, item) => (
                      <div className="flex w-full items-center justify-between gap-3">
                        <span className="text-muted-foreground">{FORECAST_CHART_CONFIG[item.dataKey as string]?.label ?? name}</span>
                        <span className="font-mono font-medium tabular-nums text-foreground">{fmtWhole(value as number)}</span>
                      </div>
                    )}
                  />
                }
              />
              <ChartLegend content={<ChartLegendContent />} />
              <Line yAxisId="left" type="monotone" dataKey="propertyValue" stroke="var(--color-propertyValue)" dot={false} strokeWidth={2} />
              <Line yAxisId="left" type="monotone" dataKey="debt" stroke="var(--color-debt)" dot={false} strokeWidth={2} />
              <Line yAxisId="left" type="monotone" dataKey="cumulativeCF" stroke="var(--color-cumulativeCF)" strokeDasharray="4 3" dot={false} strokeWidth={1.5} />
              <Line yAxisId="right" type="monotone" dataKey="netCF" stroke="var(--color-netCF)" dot={false} strokeWidth={2} />
              <Line yAxisId="right" type="monotone" dataKey="expenses" stroke="var(--color-expenses)" dot={false} strokeWidth={1.5} />
            </ComposedChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Key Milestones</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-1.5 font-medium">Year</th>
                <th className="py-1.5 font-medium">Property Value</th>
                <th className="py-1.5 font-medium">Total Debt</th>
                <th className="py-1.5 font-medium">Annual Rent</th>
                <th className="py-1.5 font-medium">Expenses</th>
                <th className="py-1.5 font-medium">Net Cashflow</th>
              </tr>
            </thead>
            <tbody>
              {milestoneYears.map((y) => {
                const row = rows[y];
                return (
                  <tr key={y} className="border-b last:border-0">
                    <td className="py-1.5 font-medium">Year {y}</td>
                    <td className="py-1.5">{fmtWhole(row.propertyValue)}</td>
                    <td className="py-1.5">{fmtWhole(row.debt)}</td>
                    <td className="py-1.5">{fmtWhole(row.rent)}</td>
                    <td className="py-1.5 text-destructive">{fmtWhole(row.expenses)}</td>
                    <td className={`py-1.5 ${row.netCF < 0 ? "text-destructive" : "text-emerald-600"}`}>{fmtWhole(row.netCF)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="text-xs text-muted-foreground">
        Projected from the assumptions above, compounded annually from today's rent, costs, property value and loan balance —
        not a guarantee of future performance.
      </div>
    </div>
  );
}

function propertyDetailsFormOf(prop: Property) {
  return {
    tenantCode: prop.tenantCode ?? "",
    councilRateRef: prop.councilRateRef ?? "",
    waterAccountRef: prop.waterAccountRef ?? "",
    managerName: prop.managerName ?? "",
    managerPhone: prop.managerPhone ?? "",
    managerEmail: prop.managerEmail ?? "",
    councilRatesAnnual: prop.councilRatesAnnual?.toString() ?? "",
    waterRatesAnnual: prop.waterRatesAnnual?.toString() ?? "",
    insuranceAnnual: prop.insuranceAnnual?.toString() ?? "",
    strataFeesAnnual: prop.strataFeesAnnual?.toString() ?? "",
    landTaxAnnual: prop.landTaxAnnual?.toString() ?? "",
    repairsMaintenanceAnnual: prop.repairsMaintenanceAnnual?.toString() ?? "",
    pmFeePercent: prop.pmFeePercent?.toString() ?? "",
    inspectionFrequencyMonths: prop.inspectionFrequencyMonths?.toString() ?? "",
    notes: prop.notes ?? "",
  };
}

function PropertyDetailsDialog({ prop, trigger }: { prop: Property; trigger?: React.ReactNode }) {
  const { updateProperty } = useStore();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(() => propertyDetailsFormOf(prop));

  const save = () => {
    updateProperty(prop.id, {
      tenantCode: form.tenantCode || undefined,
      councilRateRef: form.councilRateRef || undefined,
      waterAccountRef: form.waterAccountRef || undefined,
      managerName: form.managerName || undefined,
      managerPhone: form.managerPhone || undefined,
      managerEmail: form.managerEmail || undefined,
      councilRatesAnnual: form.councilRatesAnnual ? parseFloat(form.councilRatesAnnual) : undefined,
      waterRatesAnnual: form.waterRatesAnnual ? parseFloat(form.waterRatesAnnual) : undefined,
      insuranceAnnual: form.insuranceAnnual ? parseFloat(form.insuranceAnnual) : undefined,
      strataFeesAnnual: form.strataFeesAnnual ? parseFloat(form.strataFeesAnnual) : undefined,
      landTaxAnnual: form.landTaxAnnual ? parseFloat(form.landTaxAnnual) : undefined,
      repairsMaintenanceAnnual: form.repairsMaintenanceAnnual ? parseFloat(form.repairsMaintenanceAnnual) : undefined,
      pmFeePercent: form.pmFeePercent ? parseFloat(form.pmFeePercent) : undefined,
      inspectionFrequencyMonths: form.inspectionFrequencyMonths ? parseInt(form.inspectionFrequencyMonths, 10) : undefined,
      notes: form.notes || undefined,
    });
    toast.success("Property details saved");
    setOpen(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setForm(propertyDetailsFormOf(prop));
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="icon" variant="ghost" className="h-6 w-6">
            <Pencil className="h-3 w-3" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit property details</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-md border p-3">
            <div className="mb-2 text-sm font-medium">Operational references</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Tenant code (for maintenance portal)">
                <Input value={form.tenantCode} onChange={(e) => setForm({ ...form, tenantCode: e.target.value.toUpperCase() })} placeholder="e.g. ROSE12" />
              </Field>
              <Field label="Council rate reference">
                <Input value={form.councilRateRef} onChange={(e) => setForm({ ...form, councilRateRef: e.target.value })} placeholder="for auto-matching bills" />
              </Field>
              <Field label="Water account #">
                <Input value={form.waterAccountRef} onChange={(e) => setForm({ ...form, waterAccountRef: e.target.value })} placeholder="for auto-matching bills" />
              </Field>
            </div>
          </div>

          <div className="rounded-md border p-3">
            <div className="mb-2 text-sm font-medium">Property manager / primary contact</div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Name">
                <Input value={form.managerName} onChange={(e) => setForm({ ...form, managerName: e.target.value })} />
              </Field>
              <Field label="Phone">
                <Input value={form.managerPhone} onChange={(e) => setForm({ ...form, managerPhone: e.target.value })} />
              </Field>
              <Field label="Email">
                <Input value={form.managerEmail} onChange={(e) => setForm({ ...form, managerEmail: e.target.value })} />
              </Field>
            </div>
          </div>

          <div className="rounded-md border p-3">
            <div className="mb-1 text-sm font-medium">Annual running costs</div>
            <div className="mb-2 text-xs text-muted-foreground">Used across the property's finances.</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Council rates (annual)">
                <Input type="number" value={form.councilRatesAnnual} onChange={(e) => setForm({ ...form, councilRatesAnnual: e.target.value })} />
              </Field>
              <Field label="Water rates (annual)">
                <Input type="number" value={form.waterRatesAnnual} onChange={(e) => setForm({ ...form, waterRatesAnnual: e.target.value })} />
              </Field>
              <Field label="Insurance (annual)">
                <Input type="number" value={form.insuranceAnnual} onChange={(e) => setForm({ ...form, insuranceAnnual: e.target.value })} />
              </Field>
              <Field label="Strata fees (annual)">
                <Input type="number" value={form.strataFeesAnnual} onChange={(e) => setForm({ ...form, strataFeesAnnual: e.target.value })} />
              </Field>
              <Field label="Land tax (annual)">
                <Input type="number" value={form.landTaxAnnual} onChange={(e) => setForm({ ...form, landTaxAnnual: e.target.value })} />
              </Field>
              <Field label="Repairs & maintenance (annual)">
                <Input type="number" value={form.repairsMaintenanceAnnual} onChange={(e) => setForm({ ...form, repairsMaintenanceAnnual: e.target.value })} />
              </Field>
              <Field label="PM fee (%)">
                <Input type="number" step="0.01" value={form.pmFeePercent} onChange={(e) => setForm({ ...form, pmFeePercent: e.target.value })} />
              </Field>
              <Field label="Inspection frequency">
                <Select
                  value={form.inspectionFrequencyMonths || "__default__"}
                  onValueChange={(v) => setForm({ ...form, inspectionFrequencyMonths: v === "__default__" ? "" : v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__default__">Default (6 months)</SelectItem>
                    <SelectItem value="3">Every 3 months</SelectItem>
                    <SelectItem value="4">Every 4 months</SelectItem>
                    <SelectItem value="6">Every 6 months</SelectItem>
                    <SelectItem value="12">Every 12 months</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </div>

          <Field label="Notes">
            <Textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Anything worth remembering about this property…"
            />
          </Field>
        </div>
        <DialogFooter>
          <Button onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PropertyDetailsTab({
  prop,
  tenants,
}: {
  prop: Property;
  tenants: Tenant[];
}) {
  const { state } = useStore();
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">Operational references, running costs and notes for this property.</div>
        <PropertyDetailsDialog prop={prop} />
      </div>

      <div>
        <div className="mb-2 text-xs font-medium text-muted-foreground">Operational</div>
        <div className="grid grid-cols-2 gap-3">
          <Stat
            label="Entity"
            value={state.entities.find((e) => e.id === prop.entityId)?.name || "Unassigned"}
          />
          <Stat label="Occupancy" value={prop.occupancyType || "—"} />
          <Stat label="Tenant code" value={prop.tenantCode || "—"} />
          <Stat label="Property manager" value={prop.managerName || "—"} />
          <Stat label="Manager phone" value={prop.managerPhone || "—"} />
          <Stat label="Manager email" value={prop.managerEmail || "—"} />
          <Stat label="Council rate ref" value={prop.councilRateRef || "—"} />
          <Stat label="Water account #" value={prop.waterAccountRef || "—"} />
        </div>
      </div>

      <div>
        <div className="mb-2 text-xs font-medium text-muted-foreground">Annual running costs</div>
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Council rates" value={prop.councilRatesAnnual ? fmtCurrency(prop.councilRatesAnnual) : "—"} />
          <Stat label="Water rates" value={prop.waterRatesAnnual ? fmtCurrency(prop.waterRatesAnnual) : "—"} />
          <Stat label="Insurance" value={prop.insuranceAnnual ? fmtCurrency(prop.insuranceAnnual) : "—"} />
          <Stat label="Strata fees" value={prop.strataFeesAnnual ? fmtCurrency(prop.strataFeesAnnual) : "—"} />
          <Stat label="Land tax" value={prop.landTaxAnnual ? fmtCurrency(prop.landTaxAnnual) : "—"} />
          <Stat
            label="Repairs & maintenance"
            value={prop.repairsMaintenanceAnnual ? fmtCurrency(prop.repairsMaintenanceAnnual) : "—"}
          />
          <Stat label="PM fee" value={prop.pmFeePercent ? `${prop.pmFeePercent}%` : "—"} />
        </div>
      </div>

      {prop.notes && (
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">Notes</div>
          <div className="whitespace-pre-wrap rounded bg-muted p-3 text-sm">{prop.notes}</div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-dashed p-3 text-xs">
        <span className="text-muted-foreground">
          {tenants.length === 0
            ? "No tenants linked."
            : `${tenants.length} tenant${tenants.length === 1 ? "" : "s"} — leases, rent changes and tenancy actions live in Rental Hub now.`}
        </span>
        <Button asChild size="sm" variant="outline" className="h-7 gap-1 text-xs">
          <Link to="/rental">
            Open in Rental Hub <ArrowRight className="h-3 w-3" />
          </Link>
        </Button>
      </div>
    </div>
  );
}

export function PropertyMediaTab({ prop }: { prop: Property }) {
  const { updateProperty } = useStore();

  const onUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const photos: { name: string; data: string }[] = [];
    const videos: { name: string; data: string }[] = [];
    for (const f of Array.from(files)) {
      const data = await readFileAsDataUrl(f);
      if (f.type.startsWith("video/")) videos.push({ name: f.name, data });
      else photos.push({ name: f.name, data });
    }
    updateProperty(prop.id, {
      photos: photos.length > 0 ? [...(prop.photos ?? []), ...photos] : prop.photos,
      videos: videos.length > 0 ? [...(prop.videos ?? []), ...videos] : prop.videos,
    });
    toast.success(`${photos.length + videos.length} file${photos.length + videos.length === 1 ? "" : "s"} uploaded`);
  };

  const removePhoto = (idx: number) =>
    updateProperty(prop.id, { photos: (prop.photos ?? []).filter((_, i) => i !== idx) });
  const removeVideo = (idx: number) =>
    updateProperty(prop.id, { videos: (prop.videos ?? []).filter((_, i) => i !== idx) });

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-xs">Upload photos or videos</Label>
        <Input type="file" accept="image/*,video/*" multiple onChange={(e) => void onUpload(e.target.files)} />
      </div>
      <div>
        <div className="mb-2 text-sm font-medium">Photos ({prop.photos?.length ?? 0})</div>
        {!prop.photos?.length && <div className="text-xs text-muted-foreground">No photos yet.</div>}
        {!!prop.photos?.length && (
          <div className="flex flex-wrap gap-2">
            {prop.photos.map((p, i) => (
              <div key={i} className="relative">
                <a href={p.data} download={p.name}>
                  <img src={p.data} alt={p.name} className="h-20 w-20 rounded object-cover" />
                </a>
                <button
                  type="button"
                  onClick={() => removePhoto(i)}
                  className="absolute -right-1 -top-1 rounded-full bg-destructive p-0.5 text-destructive-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div>
        <div className="mb-2 text-sm font-medium">Videos ({prop.videos?.length ?? 0})</div>
        {!prop.videos?.length && <div className="text-xs text-muted-foreground">No videos yet.</div>}
        {prop.videos?.map((v, i) => (
          <div key={i} className="mb-2 rounded border p-2">
            <div className="mb-1 flex items-center justify-between gap-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <VideoIcon className="h-3 w-3" /> {v.name}
              </span>
              <button type="button" onClick={() => removeVideo(i)}>
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <video src={v.data} controls className="max-h-48 w-full rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

function YesNoSelect({
  value,
  onChange,
  allowNA,
}: {
  value: boolean | undefined;
  onChange: (v: boolean | undefined) => void;
  allowNA?: boolean;
}) {
  const strValue = value === undefined ? "na" : value ? "yes" : "no";
  return (
    <Select value={strValue} onValueChange={(v) => onChange(v === "na" ? undefined : v === "yes")}>
      <SelectTrigger className="h-8 w-[160px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {allowNA && <SelectItem value="na">Not applicable</SelectItem>}
        <SelectItem value="yes">Yes</SelectItem>
        <SelectItem value="no">No</SelectItem>
      </SelectContent>
    </Select>
  );
}

/**
 * 3-step "Create Tenancy Agreement" wizard (Premises → Lease & Tenant → Review/Generate),
 * mirroring the RentBetter-style flow the user referenced. Premises questions write to
 * Property (reused automatically for future tenants at the same address); lease/tenant
 * questions write to Tenant. Generation fills the landlord's own uploaded template
 * (Settings → Lease Agreement Template) via the file-agnostic field mapping — nothing here
 * invents legal wording. Works both for a brand-new tenant (no `tenant` prop) and for adding
 * agreement details to an existing one (`tenant` provided, pre-fills and skips re-asking).
 */
export function LeaseAgreementWizard({
  property,
  tenant,
  children,
}: {
  property: Property;
  tenant?: Tenant;
  children: React.ReactNode;
}) {
  const { state, updateProperty, addTenant, updateTenant, updateLandlordProfile } = useStore();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [generating, setGenerating] = useState(false);
  const [generatedBlob, setGeneratedBlob] = useState<Blob | null>(null);

  const buildPremises = () => ({
    maxOccupants: property.maxOccupants?.toString() ?? "",
    premisesInclusions: property.premisesInclusions ?? "",
    smokeAlarmType: (property.smokeAlarmType ?? "Battery") as "Hardwired" | "Battery",
    // The vast majority of NSW residential smoke alarms are battery-operated with a replaceable
    // battery, so we default to that rather than leaving the landlord to answer from scratch.
    smokeAlarmBatteryReplaceable: property.smokeAlarmBatteryReplaceable ?? true,
    smokeAlarmBatteryType: property.smokeAlarmBatteryType || SMOKE_ALARM_BATTERY_TYPES[0],
    smokeAlarmBackupBatteryReplaceable: property.smokeAlarmBackupBatteryReplaceable,
    smokeAlarmBackupBatteryType: property.smokeAlarmBackupBatteryType ?? "",
    strataResponsibleForSmokeAlarms: property.strataResponsibleForSmokeAlarms,
    strataBylawsApply: property.strataBylawsApply,
    electricalRepairsContactName: property.electricalRepairsContactName ?? "",
    electricalRepairsContactPhone: property.electricalRepairsContactPhone ?? "",
    plumbingRepairsContactName: property.plumbingRepairsContactName ?? "",
    plumbingRepairsContactPhone: property.plumbingRepairsContactPhone ?? "",
    otherRepairsContactName: property.otherRepairsContactName ?? "",
    otherRepairsContactPhone: property.otherRepairsContactPhone ?? "",
    // The form requires an answer to each of these — default to No rather than leaving them blank.
    waterUsagePaidSeparately: property.waterUsagePaidSeparately ?? false,
    electricityEmbeddedNetwork: property.electricityEmbeddedNetwork ?? false,
    gasEmbeddedNetwork: property.gasEmbeddedNetwork ?? false,
    hasSwimmingPool: property.hasSwimmingPool ?? false,
  });
  const [premises, setPremises] = useState(buildPremises);

  const buildLeaseForm = () => ({
    name: tenant?.name ?? "",
    email: tenant?.email ?? "",
    phone: tenant?.phone ?? "",
    rentAmount: tenant?.rentAmount?.toString() ?? "",
    rentFrequency: (tenant?.rentFrequency ?? "Weekly") as RentFrequency,
    bondAmount: tenant?.bondAmount?.toString() ?? "",
    bondPaidTo: (tenant?.bondPaidTo ?? "NSW Fair Trading") as NonNullable<Tenant["bondPaidTo"]>,
    leaseStart: tenant?.leaseStart ?? todayISO(),
    leaseDuration: (tenant?.leaseDuration ?? "12 Months") as LeaseDuration,
    leaseExpiry: tenant?.leaseExpiry ?? "",
    petsAllowed: tenant?.petsAllowed,
    petsDescription: tenant?.petsDescription ?? "",
    additionalLeaseTerms: tenant?.additionalLeaseTerms ?? "",
    landlordConsentsToElectronicService: tenant?.landlordConsentsToElectronicService ?? true,
    tenantConsentsToElectronicService: tenant?.tenantConsentsToElectronicService ?? true,
    // Not persisted on the tenant — this is "when/where this document was made", re-set every time.
    agreementDate: todayISO(),
    agreementPlace: property.address,
  });
  const [leaseForm, setLeaseForm] = useState(buildLeaseForm);
  const [additionalLandlords, setAdditionalLandlords] = useState<ContactPerson[]>(
    () => state.landlordProfile.additionalLandlords ?? [],
  );
  const [additionalTenants, setAdditionalTenants] = useState<ContactPerson[]>(() => tenant?.additionalTenants ?? []);

  const onOpenChange = (o: boolean) => {
    setOpen(o);
    if (o) {
      setStep(1);
      setPremises(buildPremises());
      setLeaseForm(buildLeaseForm());
      setAdditionalLandlords(state.landlordProfile.additionalLandlords ?? []);
      setAdditionalTenants(tenant?.additionalTenants ?? []);
      setGeneratedBlob(null);
    }
  };

  const updateAdditionalLandlord = (idx: number, patch: Partial<ContactPerson>) =>
    setAdditionalLandlords((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const addAdditionalLandlordRow = () => setAdditionalLandlords((rows) => [...rows, { name: "" }]);
  const removeAdditionalLandlordRow = (idx: number) => setAdditionalLandlords((rows) => rows.filter((_, i) => i !== idx));

  const updateAdditionalTenant = (idx: number, patch: Partial<ContactPerson>) =>
    setAdditionalTenants((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const addAdditionalTenantRow = () => setAdditionalTenants((rows) => [...rows, { name: "" }]);
  const removeAdditionalTenantRow = (idx: number) => setAdditionalTenants((rows) => rows.filter((_, i) => i !== idx));

  const onStartChange = (v: string) => {
    setLeaseForm((s) => ({
      ...s,
      leaseStart: v,
      leaseExpiry: s.leaseDuration !== "Periodic" ? computeLeaseEnd(v, s.leaseDuration) : s.leaseExpiry,
    }));
  };
  const onDurationChange = (v: LeaseDuration) => {
    setLeaseForm((s) => ({
      ...s,
      leaseDuration: v,
      leaseExpiry: v === "Periodic" ? "" : computeLeaseEnd(s.leaseStart, v),
    }));
  };

  const saveStep1 = () => {
    updateProperty(property.id, {
      maxOccupants: premises.maxOccupants ? parseInt(premises.maxOccupants, 10) : undefined,
      premisesInclusions: premises.premisesInclusions || undefined,
      smokeAlarmType: premises.smokeAlarmType,
      smokeAlarmBatteryReplaceable: premises.smokeAlarmBatteryReplaceable,
      smokeAlarmBatteryType: premises.smokeAlarmBatteryType || undefined,
      smokeAlarmBackupBatteryReplaceable: premises.smokeAlarmBackupBatteryReplaceable,
      smokeAlarmBackupBatteryType: premises.smokeAlarmBackupBatteryType || undefined,
      strataResponsibleForSmokeAlarms: premises.strataResponsibleForSmokeAlarms,
      strataBylawsApply: premises.strataBylawsApply,
      electricalRepairsContactName: premises.electricalRepairsContactName || undefined,
      electricalRepairsContactPhone: premises.electricalRepairsContactPhone || undefined,
      plumbingRepairsContactName: premises.plumbingRepairsContactName || undefined,
      plumbingRepairsContactPhone: premises.plumbingRepairsContactPhone || undefined,
      otherRepairsContactName: premises.otherRepairsContactName || undefined,
      otherRepairsContactPhone: premises.otherRepairsContactPhone || undefined,
      waterUsagePaidSeparately: premises.waterUsagePaidSeparately,
      electricityEmbeddedNetwork: premises.electricityEmbeddedNetwork,
      gasEmbeddedNetwork: premises.gasEmbeddedNetwork,
      hasSwimmingPool: premises.hasSwimmingPool,
    });
    setStep(2);
  };

  const saveStep2 = () => {
    if (!leaseForm.name) return toast.error("Tenant name required");
    if (!leaseForm.rentAmount) return toast.error("Rent amount required");
    const cleanedAdditionalTenants = additionalTenants.filter((t) => t.name.trim());
    const patch = {
      name: leaseForm.name,
      email: leaseForm.email || undefined,
      phone: leaseForm.phone || undefined,
      rentAmount: parseFloat(leaseForm.rentAmount) || 0,
      rentFrequency: leaseForm.rentFrequency,
      bondAmount: leaseForm.bondAmount ? parseFloat(leaseForm.bondAmount) : undefined,
      bondPaidTo: leaseForm.bondAmount ? leaseForm.bondPaidTo : undefined,
      leaseStart: leaseForm.leaseStart || undefined,
      leaseExpiry: leaseForm.leaseExpiry || undefined,
      leaseDuration: leaseForm.leaseDuration,
      petsAllowed: leaseForm.petsAllowed,
      petsDescription: leaseForm.petsAllowed ? leaseForm.petsDescription || undefined : undefined,
      additionalLeaseTerms: leaseForm.additionalLeaseTerms || undefined,
      additionalTenants: cleanedAdditionalTenants.length ? cleanedAdditionalTenants : undefined,
      landlordConsentsToElectronicService: leaseForm.landlordConsentsToElectronicService,
      tenantConsentsToElectronicService: leaseForm.tenantConsentsToElectronicService,
      propertyId: property.id,
    };
    if (tenant) updateTenant(tenant.id, patch);
    else addTenant(patch);

    const cleanedAdditionalLandlords = additionalLandlords.filter((l) => l.name.trim());
    updateLandlordProfile({ additionalLandlords: cleanedAdditionalLandlords });

    setStep(3);
  };

  const buildValues = (): Record<string, string | boolean | undefined> => ({
    agreementDate: toDDMMYYYY(leaseForm.agreementDate) || undefined,
    agreementPlace: leaseForm.agreementPlace || undefined,

    landlordName: state.landlordProfile.fullName || undefined,
    landlordEmail: leaseForm.landlordConsentsToElectronicService ? state.landlordProfile.email || undefined : undefined,
    landlordPhone: state.landlordProfile.phone || undefined,
    landlordContactDetails:
      [state.landlordProfile.phone, state.landlordProfile.email].filter(Boolean).join(" / ") || undefined,
    landlordName2: additionalLandlords[0]?.name || undefined,
    landlordConsentsToElectronicService: leaseForm.landlordConsentsToElectronicService,

    propertyAddress: tenant?.unitAddress || property.address,
    hasSwimmingPool: premises.hasSwimmingPool,
    maxOccupants: premises.maxOccupants || undefined,
    premisesInclusions: premises.premisesInclusions || undefined,
    smokeAlarmType: premises.smokeAlarmType,
    smokeAlarmBatteryReplaceable: premises.smokeAlarmBatteryReplaceable,
    smokeAlarmBatteryType: premises.smokeAlarmBatteryType || undefined,
    smokeAlarmBackupBatteryReplaceable: premises.smokeAlarmBackupBatteryReplaceable,
    smokeAlarmBackupBatteryType: premises.smokeAlarmBackupBatteryType || undefined,
    strataResponsibleForSmokeAlarms: premises.strataResponsibleForSmokeAlarms,
    strataBylawsApply: premises.strataBylawsApply,
    electricalRepairsContactName: premises.electricalRepairsContactName || undefined,
    electricalRepairsContactPhone: premises.electricalRepairsContactPhone || undefined,
    plumbingRepairsContactName: premises.plumbingRepairsContactName || undefined,
    plumbingRepairsContactPhone: premises.plumbingRepairsContactPhone || undefined,
    otherRepairsContactName: premises.otherRepairsContactName || undefined,
    otherRepairsContactPhone: premises.otherRepairsContactPhone || undefined,
    waterUsagePaidSeparately: premises.waterUsagePaidSeparately,
    electricityEmbeddedNetwork: premises.electricityEmbeddedNetwork,
    gasEmbeddedNetwork: premises.gasEmbeddedNetwork,

    tenantName: leaseForm.name || undefined,
    tenantEmail: leaseForm.tenantConsentsToElectronicService ? leaseForm.email || undefined : undefined,
    tenantPhone: leaseForm.phone || undefined,
    tenantContactDetails: [leaseForm.phone, leaseForm.email].filter(Boolean).join(" / ") || undefined,
    tenantName2: additionalTenants[0]?.name || undefined,
    tenantName3: additionalTenants[1]?.name || undefined,
    tenantNameOthers: additionalTenants.slice(2).map((t) => t.name).filter(Boolean).join(", ") || undefined,
    tenantConsentsToElectronicService: leaseForm.tenantConsentsToElectronicService,
    rentAmount: leaseForm.rentAmount || undefined,
    rentFrequency: leaseForm.rentFrequency,
    bondAmount: leaseForm.bondAmount || undefined,
    bondPaidTo: leaseForm.bondAmount ? leaseForm.bondPaidTo : undefined,
    leaseStart: toDDMMYYYY(leaseForm.leaseStart) || undefined,
    leaseExpiry: toDDMMYYYY(leaseForm.leaseExpiry) || undefined,
    leaseDuration: leaseForm.leaseDuration,
    petsAllowed: leaseForm.petsAllowed,
    petsDescription: leaseForm.petsAllowed ? leaseForm.petsDescription || undefined : undefined,
    additionalLeaseTerms:
      [
        leaseForm.petsAllowed === false ? "No pets are permitted at this property." : "",
        leaseForm.additionalLeaseTerms,
      ]
        .filter(Boolean)
        .join("\n\n") || undefined,
  });

  const fileName = `lease-agreement-${(leaseForm.name || "tenant").replace(/\s+/g, "-").toLowerCase()}-${todayISO()}.pdf`;

  const generate = async () => {
    if (!state.leaseTemplate) {
      return toast.error("Upload a lease agreement template in Settings first");
    }
    setGenerating(true);
    try {
      let bytes = await fillLeaseTemplate(state.leaseTemplate, buildValues());
      if (state.tenantInfoStatement) {
        bytes = await appendPdf(bytes, state.tenantInfoStatement.fileData);
      }
      setGeneratedBlob(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      toast.success(
        state.tenantInfoStatement
          ? "Lease agreement generated (with Tenant Information Statement attached)"
          : "Lease agreement generated",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not generate the document");
    } finally {
      setGenerating(false);
    }
  };

  const download = () => {
    if (generatedBlob) downloadBlob(generatedBlob, fileName);
  };

  const emailToTenant = () => {
    if (!generatedBlob) return;
    const propertyLabel = property.alias || property.address;
    const body = `Dear ${leaseForm.name},\n\nPlease find your tenancy agreement for ${propertyLabel} attached to this email — I've just downloaded it as a PDF; please attach the file (from your Downloads) before sending.\n\nKind regards,\n${state.landlordProfile.fullName || "The Landlord"}`;
    downloadPdfAndEmailViaGmail({
      blob: generatedBlob,
      fileName,
      to: leaseForm.email,
      subject: `Tenancy agreement — ${propertyLabel}`,
      body,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Create Tenancy Agreement — Step {step} of 3:{" "}
            {step === 1 ? "Premises Details" : step === 2 ? "Lease & Tenant Details" : "Review & Generate"}
          </DialogTitle>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">
              These describe the property itself — captured once, reused automatically next time
              you onboard a tenant here.
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Maximum occupants">
                <Input
                  type="number"
                  value={premises.maxOccupants}
                  onChange={(e) => setPremises({ ...premises, maxOccupants: e.target.value })}
                />
              </Field>
              <Field label="Inclusions">
                <Input
                  placeholder="e.g. 1 car space, dishwasher"
                  value={premises.premisesInclusions}
                  onChange={(e) => setPremises({ ...premises, premisesInclusions: e.target.value })}
                />
              </Field>
            </div>

            <div className="rounded-md border p-3">
              <div className="mb-2 text-sm font-medium">Smoke alarms</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Type">
                  <Select
                    value={premises.smokeAlarmType}
                    onValueChange={(v) => setPremises({ ...premises, smokeAlarmType: v as "Hardwired" | "Battery" })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Battery">Battery operated</SelectItem>
                      <SelectItem value="Hardwired">Hardwired</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                {premises.smokeAlarmType === "Battery" ? (
                  <>
                    <Field label="Battery tenant-replaceable?">
                      <YesNoSelect
                        value={premises.smokeAlarmBatteryReplaceable}
                        onChange={(v) => setPremises({ ...premises, smokeAlarmBatteryReplaceable: v ?? true })}
                      />
                    </Field>
                    {premises.smokeAlarmBatteryReplaceable && (
                      <Field label="Battery type">
                        <Select
                          value={premises.smokeAlarmBatteryType}
                          onValueChange={(v) => setPremises({ ...premises, smokeAlarmBatteryType: v })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {SMOKE_ALARM_BATTERY_TYPES.map((t) => (
                              <SelectItem key={t} value={t}>
                                {t}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                    )}
                  </>
                ) : (
                  <>
                    <Field label="Backup battery tenant-replaceable?">
                      <YesNoSelect
                        value={premises.smokeAlarmBackupBatteryReplaceable}
                        onChange={(v) => setPremises({ ...premises, smokeAlarmBackupBatteryReplaceable: v })}
                      />
                    </Field>
                    {premises.smokeAlarmBackupBatteryReplaceable && (
                      <Field label="Backup battery type">
                        <Input
                          value={premises.smokeAlarmBackupBatteryType}
                          onChange={(e) =>
                            setPremises({ ...premises, smokeAlarmBackupBatteryType: e.target.value })
                          }
                        />
                      </Field>
                    )}
                  </>
                )}
                <Field label="Owners corp. responsible for smoke alarms?">
                  <YesNoSelect
                    allowNA
                    value={premises.strataResponsibleForSmokeAlarms}
                    onChange={(v) => setPremises({ ...premises, strataResponsibleForSmokeAlarms: v })}
                  />
                </Field>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Strata/community by-laws apply?">
                <YesNoSelect
                  value={premises.strataBylawsApply}
                  onChange={(v) => setPremises({ ...premises, strataBylawsApply: v })}
                />
              </Field>
              <Field label="Tenant pays water usage separately? (Required)">
                <YesNoSelect
                  value={premises.waterUsagePaidSeparately}
                  onChange={(v) => setPremises({ ...premises, waterUsagePaidSeparately: v ?? false })}
                />
              </Field>
              <Field label="Electricity from embedded network? (Required)">
                <YesNoSelect
                  value={premises.electricityEmbeddedNetwork}
                  onChange={(v) => setPremises({ ...premises, electricityEmbeddedNetwork: v ?? false })}
                />
              </Field>
              <Field label="Gas from embedded network? (Required)">
                <YesNoSelect
                  value={premises.gasEmbeddedNetwork}
                  onChange={(v) => setPremises({ ...premises, gasEmbeddedNetwork: v ?? false })}
                />
              </Field>
              <Field label="Swimming pool on the premises? (Required)">
                <YesNoSelect
                  value={premises.hasSwimmingPool}
                  onChange={(v) => setPremises({ ...premises, hasSwimmingPool: v ?? false })}
                />
              </Field>
            </div>

            <div className="rounded-md border p-3">
              <div className="mb-2 text-sm font-medium">Nominated repairs contacts (optional)</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Electrical — contact name">
                  <Input
                    value={premises.electricalRepairsContactName}
                    onChange={(e) => setPremises({ ...premises, electricalRepairsContactName: e.target.value })}
                  />
                </Field>
                <Field label="Electrical — phone">
                  <Input
                    value={premises.electricalRepairsContactPhone}
                    onChange={(e) => setPremises({ ...premises, electricalRepairsContactPhone: e.target.value })}
                  />
                </Field>
                <Field label="Plumbing — contact name">
                  <Input
                    value={premises.plumbingRepairsContactName}
                    onChange={(e) => setPremises({ ...premises, plumbingRepairsContactName: e.target.value })}
                  />
                </Field>
                <Field label="Plumbing — phone">
                  <Input
                    value={premises.plumbingRepairsContactPhone}
                    onChange={(e) => setPremises({ ...premises, plumbingRepairsContactPhone: e.target.value })}
                  />
                </Field>
                <Field label="Other — contact name">
                  <Input
                    value={premises.otherRepairsContactName}
                    onChange={(e) => setPremises({ ...premises, otherRepairsContactName: e.target.value })}
                  />
                </Field>
                <Field label="Other — phone">
                  <Input
                    value={premises.otherRepairsContactPhone}
                    onChange={(e) => setPremises({ ...premises, otherRepairsContactPhone: e.target.value })}
                  />
                </Field>
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <div className="rounded-md border p-3">
              <div className="mb-2 text-sm font-medium">Agreement details</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Date agreement was made">
                  <Input
                    type="date"
                    value={leaseForm.agreementDate}
                    onChange={(e) => setLeaseForm({ ...leaseForm, agreementDate: e.target.value })}
                  />
                </Field>
                <Field label="Place agreement was made">
                  <Input
                    value={leaseForm.agreementPlace}
                    onChange={(e) => setLeaseForm({ ...leaseForm, agreementPlace: e.target.value })}
                  />
                </Field>
              </div>
            </div>

            <div className="rounded-md border p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-medium">Landlord(s)</div>
                <Button type="button" size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={addAdditionalLandlordRow}>
                  <Plus className="h-3 w-3" /> Add co-landlord
                </Button>
              </div>
              <div className="text-xs text-muted-foreground">
                {state.landlordProfile.fullName || "(no landlord name set in Settings)"}
                {state.landlordProfile.email ? ` • ${state.landlordProfile.email}` : ""}
              </div>
              {additionalLandlords.map((l, idx) => (
                <div key={idx} className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
                  <Field label="Name">
                    <Input value={l.name} onChange={(e) => updateAdditionalLandlord(idx, { name: e.target.value })} />
                  </Field>
                  <Field label="Email">
                    <Input
                      type="email"
                      value={l.email ?? ""}
                      onChange={(e) => updateAdditionalLandlord(idx, { email: e.target.value })}
                    />
                  </Field>
                  <Field label="Phone">
                    <Input
                      inputMode="tel"
                      value={l.phone ?? ""}
                      onChange={(e) => updateAdditionalLandlord(idx, { phone: e.target.value })}
                    />
                  </Field>
                  <Button size="icon" variant="ghost" onClick={() => removeAdditionalLandlordRow(idx)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>

            {tenant ? (
              <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                Using existing tenant details for <span className="font-medium text-foreground">{tenant.name}</span>{" "}
                — edit via the pencil icon on their row if these need to change.
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Tenant name *">
                  <Input value={leaseForm.name} onChange={(e) => setLeaseForm({ ...leaseForm, name: e.target.value })} />
                </Field>
                <Field label="Email">
                  <Input value={leaseForm.email} onChange={(e) => setLeaseForm({ ...leaseForm, email: e.target.value })} />
                </Field>
                <Field label="Phone">
                  <Input value={leaseForm.phone} onChange={(e) => setLeaseForm({ ...leaseForm, phone: e.target.value })} />
                </Field>
                <Field label="Rent amount (AUD) *">
                  <Input
                    type="number"
                    value={leaseForm.rentAmount}
                    onChange={(e) => setLeaseForm({ ...leaseForm, rentAmount: e.target.value })}
                  />
                </Field>
                <Field label="Rent frequency">
                  <Select
                    value={leaseForm.rentFrequency}
                    onValueChange={(v) => setLeaseForm({ ...leaseForm, rentFrequency: v as RentFrequency })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Weekly">Weekly</SelectItem>
                      <SelectItem value="Fortnightly">Fortnightly</SelectItem>
                      <SelectItem value="Monthly">Monthly</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Bond amount (AUD)">
                  <Input
                    type="number"
                    value={leaseForm.bondAmount}
                    onChange={(e) => setLeaseForm({ ...leaseForm, bondAmount: e.target.value })}
                  />
                </Field>
                <Field label="Lease start date">
                  <Input type="date" value={leaseForm.leaseStart} onChange={(e) => onStartChange(e.target.value)} />
                </Field>
                <Field label="Lease duration">
                  <Select value={leaseForm.leaseDuration} onValueChange={(v) => onDurationChange(v as LeaseDuration)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="6 Months">6 Months</SelectItem>
                      <SelectItem value="12 Months">12 Months</SelectItem>
                      <SelectItem value="Periodic">Periodic / Ongoing</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            )}

            <div className="rounded-md border p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-medium">Co-tenants</div>
                <Button type="button" size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={addAdditionalTenantRow}>
                  <Plus className="h-3 w-3" /> Add co-tenant
                </Button>
              </div>
              {additionalTenants.length === 0 && (
                <div className="text-xs text-muted-foreground">
                  {leaseForm.name || "This tenant"} is the only tenant on this agreement.
                </div>
              )}
              {additionalTenants.map((t, idx) => (
                <div key={idx} className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
                  <Field label="Name">
                    <Input value={t.name} onChange={(e) => updateAdditionalTenant(idx, { name: e.target.value })} />
                  </Field>
                  <Field label="Email">
                    <Input
                      type="email"
                      value={t.email ?? ""}
                      onChange={(e) => updateAdditionalTenant(idx, { email: e.target.value })}
                    />
                  </Field>
                  <Field label="Phone">
                    <Input
                      inputMode="tel"
                      value={t.phone ?? ""}
                      onChange={(e) => updateAdditionalTenant(idx, { phone: e.target.value })}
                    />
                  </Field>
                  <Button size="icon" variant="ghost" onClick={() => removeAdditionalTenantRow(idx)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>

            {tenant && (
              <Field label="Bond amount (AUD)">
                <Input
                  type="number"
                  value={leaseForm.bondAmount}
                  onChange={(e) => setLeaseForm({ ...leaseForm, bondAmount: e.target.value })}
                />
              </Field>
            )}
            {leaseForm.bondAmount && (
              <Field label="Bond paid to">
                <Select
                  value={leaseForm.bondPaidTo}
                  onValueChange={(v) => setLeaseForm({ ...leaseForm, bondPaidTo: v as NonNullable<Tenant["bondPaidTo"]> })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NSW Fair Trading">NSW Fair Trading (Rental Bond Online)</SelectItem>
                    <SelectItem value="Landlord">The landlord or another person</SelectItem>
                    <SelectItem value="Agent">The landlord's agent</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            )}

            <div className="rounded-md border p-3">
              <div className="mb-2 text-sm font-medium">Electronic service of notices and documents</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Landlord consents?">
                  <YesNoSelect
                    value={leaseForm.landlordConsentsToElectronicService}
                    onChange={(v) => setLeaseForm({ ...leaseForm, landlordConsentsToElectronicService: v ?? true })}
                  />
                </Field>
                <Field label="Tenant consents?">
                  <YesNoSelect
                    value={leaseForm.tenantConsentsToElectronicService}
                    onChange={(v) => setLeaseForm({ ...leaseForm, tenantConsentsToElectronicService: v ?? true })}
                  />
                </Field>
              </div>
            </div>

            <div className="rounded-md border p-3">
              <div className="mb-2 text-sm font-medium">Pets on the premises</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Tenant may keep a pet?">
                  <YesNoSelect
                    value={leaseForm.petsAllowed}
                    onChange={(v) => setLeaseForm({ ...leaseForm, petsAllowed: v })}
                  />
                </Field>
                {leaseForm.petsAllowed && (
                  <Field label="Breed / size / details">
                    <Input
                      value={leaseForm.petsDescription}
                      onChange={(e) => setLeaseForm({ ...leaseForm, petsDescription: e.target.value })}
                    />
                  </Field>
                )}
              </div>
            </div>

            <Field label="Additional terms">
              <Textarea
                value={leaseForm.additionalLeaseTerms}
                onChange={(e) => setLeaseForm({ ...leaseForm, additionalLeaseTerms: e.target.value })}
                placeholder="Any additional terms or conditions, added as a separate section."
              />
            </Field>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3 text-sm">
            <div className="rounded-md border p-3">
              <div className="mb-2 font-medium">{property.alias || property.address}</div>
              <div className="text-xs text-muted-foreground">
                {leaseForm.name} — {fmtCurrency(parseFloat(leaseForm.rentAmount) || 0)}/{leaseForm.rentFrequency} •{" "}
                {leaseForm.leaseDuration} from {leaseForm.leaseStart}
                {leaseForm.leaseExpiry && ` to ${leaseForm.leaseExpiry}`}
              </div>
            </div>

            {(premises.hasSwimmingPool === false || leaseForm.petsAllowed === false) && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs space-y-1">
                <div className="font-medium">Before signing, review these printed clauses:</div>
                {premises.hasSwimmingPool === false && (
                  <div>• No pool at this property — consider crossing out the swimming pool section on page 13.</div>
                )}
                {leaseForm.petsAllowed === false && (
                  <div>
                    • No pets — consider crossing out "Additional Terms – Pets" (clauses 57–59) on page 15. A note
                    has also been added to Additional Terms.
                  </div>
                )}
              </div>
            )}

            {!state.leaseTemplate ? (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
                No lease agreement template uploaded yet. Go to Settings → Lease Agreement Template
                to upload your fillable tenancy agreement and map its fields, then come back here
                to generate.
              </div>
            ) : (
              <>
                <Button onClick={generate} disabled={generating} className="gap-2">
                  <FileSignature className="h-4 w-4" />
                  {generating ? "Generating…" : "Generate Lease Agreement PDF"}
                </Button>
                {generatedBlob && (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={download}>
                      Download
                    </Button>
                    <Button size="sm" variant="outline" onClick={emailToTenant} disabled={!leaseForm.email}>
                      Email to tenant
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <DialogFooter className="flex items-center justify-between sm:justify-between">
          <Button variant="ghost" disabled={step === 1} onClick={() => setStep((s) => (s - 1) as 1 | 2)}>
            Back
          </Button>
          {step < 3 ? (
            <Button onClick={step === 1 ? saveStep1 : saveStep2}>Next</Button>
          ) : (
            <Button variant="outline" onClick={() => setOpen(false)}>
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PropertyBillsTab({ propertyId }: { propertyId: string }) {
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          Bills processed by email, upload or entered here all show up below, with their source document linked.
        </div>
        <AddBillDialog propertyId={propertyId} />
      </div>

      <BillsBoard propertyId={propertyId} />
    </div>
  );
}




export function RentChangeRow({ entry }: { entry: RentChange }) {
  const { updateRentChange, deleteRentChange } = useStore();
  const [editing, setEditing] = useState(false);
  const [changeDate, setChangeDate] = useState(entry.changeDate);
  const [oldRent, setOldRent] = useState(entry.oldRent.toString());
  const [newRent, setNewRent] = useState(entry.newRent.toString());

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span>
          {entry.changeDate}: rent {fmtCurrency(entry.oldRent)} → {fmtCurrency(entry.newRent)}
        </span>
        <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => setEditing(true)}>
          <Pencil className="h-3 w-3" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-5 w-5"
          onClick={() => {
            if (confirm("Delete this rent-change record? Paid-up-to date will be recalculated.")) {
              deleteRentChange(entry.id);
              toast.success("Rent-change record deleted");
            }
          }}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input type="date" value={changeDate} onChange={(e) => setChangeDate(e.target.value)} className="h-6 w-32 text-xs" />
      <Input
        type="number"
        value={oldRent}
        onChange={(e) => setOldRent(e.target.value)}
        className="h-6 w-20 text-xs"
        title="Old rent"
      />
      <span>→</span>
      <Input
        type="number"
        value={newRent}
        onChange={(e) => setNewRent(e.target.value)}
        className="h-6 w-20 text-xs"
        title="New rent"
      />
      <Button
        size="sm"
        className="h-6 px-2 text-xs"
        onClick={() => {
          updateRentChange(entry.id, {
            changeDate,
            oldRent: parseFloat(oldRent) || 0,
            newRent: parseFloat(newRent) || 0,
          });
          setEditing(false);
          toast.success("Rent-change record updated");
        }}
      >
        Save
      </Button>
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditing(false)}>
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}

export function LeaseHistoryRow({ entry }: { entry: LeaseHistory }) {
  const { updateLeaseHistory, deleteLeaseHistory } = useStore();
  const [editing, setEditing] = useState(false);
  const [pastStartDate, setPastStartDate] = useState(entry.pastStartDate);
  const [pastEndDate, setPastEndDate] = useState(entry.pastEndDate ?? "");
  const [pastRent, setPastRent] = useState(entry.pastRent.toString());

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span>
          Previous lease: {entry.pastStartDate} → {entry.pastEndDate || "Periodic"} @ {fmtCurrency(entry.pastRent)}/
          {entry.pastFrequency}
        </span>
        {entry.leaseDocumentFileData && (
          <DocumentLink fileName={entry.leaseDocumentFileName || "lease.pdf"} fileData={entry.leaseDocumentFileData} className="text-primary underline">
            View lease
          </DocumentLink>
        )}
        <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => setEditing(true)}>
          <Pencil className="h-3 w-3" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-5 w-5"
          onClick={() => {
            if (confirm("Delete this lease-history record?")) {
              deleteLeaseHistory(entry.id);
              toast.success("Lease-history record deleted");
            }
          }}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input type="date" value={pastStartDate} onChange={(e) => setPastStartDate(e.target.value)} className="h-6 w-32 text-xs" />
      <span>→</span>
      <Input
        type="date"
        value={pastEndDate}
        onChange={(e) => setPastEndDate(e.target.value)}
        className="h-6 w-32 text-xs"
        placeholder="Periodic"
      />
      <span>@</span>
      <Input type="number" value={pastRent} onChange={(e) => setPastRent(e.target.value)} className="h-6 w-20 text-xs" />
      <Button
        size="sm"
        className="h-6 px-2 text-xs"
        onClick={() => {
          updateLeaseHistory(entry.id, { pastStartDate, pastEndDate: pastEndDate || undefined, pastRent: parseFloat(pastRent) || 0 });
          setEditing(false);
          toast.success("Lease-history record updated");
        }}
      >
        Save
      </Button>
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditing(false)}>
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}

const PROVIDER_ROLES: ProviderRole[] = [
  "Agent",
  "Council",
  "Water",
  "Electricity",
  "Gas",
  "Insurer",
  "Strata",
  "Trade",
  "Accountant",
  "Mortgage Broker",
  "Conveyancer",
  "Quantity Surveyor",
  "Pest Control",
  "Cleaning",
  "Gardening",
  "Real Estate Agent",
  "Other",
];

interface AgencyAgreementExtractResult {
  ok?: boolean;
  error?: string;
  management_fee_percent?: number | null;
  management_fee_gst_inclusive?: boolean | null;
  letting_fee_amount?: number | null;
  letting_fee_weeks_rent?: number | null;
  letting_fee_gst_inclusive?: boolean | null;
  admin_fee_amount?: number | null;
  admin_fee_frequency?: string | null;
  admin_fee_gst_inclusive?: boolean | null;
  lease_renewal_fee_amount?: number | null;
  lease_renewal_fee_gst_inclusive?: boolean | null;
  inspection_fee_amount?: number | null;
  inspection_fee_gst_inclusive?: boolean | null;
  inspections_per_year?: number | null;
  advertising_fee_amount?: number | null;
  advertising_fee_gst_inclusive?: boolean | null;
  lease_preparation_fee_amount?: number | null;
  lease_preparation_fee_gst_inclusive?: boolean | null;
  ncat_fee_amount?: string | null;
  ncat_fee_gst_inclusive?: boolean | null;
  agent_pays_water_usage?: boolean | null;
  agent_pays_land_tax?: boolean | null;
  agent_pays_council_rates?: boolean | null;
  notice_period_days?: number | null;
  agency_name?: string | null;
  contract_start_date?: string | null;
  contract_review_date?: string | null;
  confidence?: number;
}

const FEE_FREQUENCIES: FeeFrequency[] = ["Per Statement", "Monthly", "Quarterly", "Annually"];

interface AgreementFormState {
  contractFileName: string;
  contractFileData: string;
  managementFeePercent: string;
  managementFeeGstInclusive: boolean;
  lettingFeeAmount: string;
  lettingFeeWeeksRent: string;
  lettingFeeGstInclusive: boolean;
  adminFeeAmount: string;
  adminFeeFrequency: string;
  adminFeeGstInclusive: boolean;
  leaseRenewalFeeAmount: string;
  leaseRenewalFeeGstInclusive: boolean;
  inspectionFeeAmount: string;
  inspectionFeeGstInclusive: boolean;
  inspectionsPerYear: string;
  advertisingFeeAmount: string;
  advertisingFeeGstInclusive: boolean;
  leasePreparationFeeAmount: string;
  leasePreparationFeeGstInclusive: boolean;
  ncatFeeAmount: string;
  ncatFeeGstInclusive: boolean;
  agentPaysWaterUsage: boolean;
  agentPaysLandTax: boolean;
  agentPaysCouncilRates: boolean;
  noticePeriodDays: string;
  contractStartDate: string;
  contractReviewDate: string;
  contractNotes: string;
}

function agreementFormFrom(agreement?: Partial<ProviderAgreement>): AgreementFormState {
  return {
    contractFileName: agreement?.contractFileName ?? "",
    contractFileData: agreement?.contractFileData ?? "",
    managementFeePercent: agreement?.managementFeePercent !== undefined ? String(agreement.managementFeePercent) : "",
    managementFeeGstInclusive: agreement?.managementFeeGstInclusive ?? false,
    lettingFeeAmount: agreement?.lettingFeeAmount !== undefined ? String(agreement.lettingFeeAmount) : "",
    lettingFeeWeeksRent: agreement?.lettingFeeWeeksRent !== undefined ? String(agreement.lettingFeeWeeksRent) : "",
    lettingFeeGstInclusive: agreement?.lettingFeeGstInclusive ?? false,
    adminFeeAmount: agreement?.adminFeeAmount !== undefined ? String(agreement.adminFeeAmount) : "",
    adminFeeFrequency: agreement?.adminFeeFrequency ?? "",
    adminFeeGstInclusive: agreement?.adminFeeGstInclusive ?? false,
    leaseRenewalFeeAmount: agreement?.leaseRenewalFeeAmount !== undefined ? String(agreement.leaseRenewalFeeAmount) : "",
    leaseRenewalFeeGstInclusive: agreement?.leaseRenewalFeeGstInclusive ?? false,
    inspectionFeeAmount: agreement?.inspectionFeeAmount !== undefined ? String(agreement.inspectionFeeAmount) : "",
    inspectionFeeGstInclusive: agreement?.inspectionFeeGstInclusive ?? false,
    inspectionsPerYear: agreement?.inspectionsPerYear !== undefined ? String(agreement.inspectionsPerYear) : "",
    advertisingFeeAmount: agreement?.advertisingFeeAmount !== undefined ? String(agreement.advertisingFeeAmount) : "",
    advertisingFeeGstInclusive: agreement?.advertisingFeeGstInclusive ?? false,
    leasePreparationFeeAmount: agreement?.leasePreparationFeeAmount !== undefined ? String(agreement.leasePreparationFeeAmount) : "",
    leasePreparationFeeGstInclusive: agreement?.leasePreparationFeeGstInclusive ?? false,
    ncatFeeAmount: agreement?.ncatFeeAmount ?? "",
    ncatFeeGstInclusive: agreement?.ncatFeeGstInclusive ?? false,
    agentPaysWaterUsage: agreement?.agentPaysWaterUsage ?? false,
    agentPaysLandTax: agreement?.agentPaysLandTax ?? false,
    agentPaysCouncilRates: agreement?.agentPaysCouncilRates ?? false,
    noticePeriodDays: agreement?.noticePeriodDays !== undefined ? String(agreement.noticePeriodDays) : "",
    contractStartDate: agreement?.contractStartDate ?? "",
    contractReviewDate: agreement?.contractReviewDate ?? "",
    contractNotes: agreement?.contractNotes ?? "",
  };
}

function agreementPayloadFrom(form: AgreementFormState) {
  const num = (s: string) => (s.trim() ? parseFloat(s) : undefined);
  return {
    contractFileName: form.contractFileName || undefined,
    contractFileData: form.contractFileData || undefined,
    managementFeePercent: num(form.managementFeePercent),
    managementFeeGstInclusive: form.managementFeeGstInclusive,
    lettingFeeAmount: num(form.lettingFeeAmount),
    lettingFeeWeeksRent: num(form.lettingFeeWeeksRent),
    lettingFeeGstInclusive: form.lettingFeeGstInclusive,
    adminFeeAmount: num(form.adminFeeAmount),
    adminFeeFrequency: (form.adminFeeFrequency || undefined) as FeeFrequency | undefined,
    adminFeeGstInclusive: form.adminFeeGstInclusive,
    leaseRenewalFeeAmount: num(form.leaseRenewalFeeAmount),
    leaseRenewalFeeGstInclusive: form.leaseRenewalFeeGstInclusive,
    inspectionFeeAmount: num(form.inspectionFeeAmount),
    inspectionFeeGstInclusive: form.inspectionFeeGstInclusive,
    inspectionsPerYear: num(form.inspectionsPerYear),
    advertisingFeeAmount: num(form.advertisingFeeAmount),
    advertisingFeeGstInclusive: form.advertisingFeeGstInclusive,
    leasePreparationFeeAmount: num(form.leasePreparationFeeAmount),
    leasePreparationFeeGstInclusive: form.leasePreparationFeeGstInclusive,
    ncatFeeAmount: form.ncatFeeAmount.trim() || undefined,
    ncatFeeGstInclusive: form.ncatFeeGstInclusive,
    agentPaysWaterUsage: form.agentPaysWaterUsage,
    agentPaysLandTax: form.agentPaysLandTax,
    agentPaysCouncilRates: form.agentPaysCouncilRates,
    noticePeriodDays: num(form.noticePeriodDays),
    contractStartDate: form.contractStartDate || undefined,
    contractReviewDate: form.contractReviewDate || undefined,
    contractNotes: form.contractNotes.trim() || undefined,
  };
}

/** Shared AI-extraction for a signed management agreement PDF — fills whichever agreement-form
 * fields the extraction found, never overwriting a value already typed in. Used by both
 * ProviderDialog's Agreement section and ProviderAgreementDialog (the provider profile page's
 * add/edit-agreement flow) so both entry points behave identically. Returns the extracted agency
 * name, if any, so a caller creating a brand-new Contact + Agreement together can offer to prefill
 * the contact's own name field too. */
async function extractAgreementFile(
  file: File,
  setForm: React.Dispatch<React.SetStateAction<AgreementFormState>>,
  setBusy: (v: boolean) => void,
  setExtractSummary: (v: { fields: number; confidence: number } | null) => void,
): Promise<string | undefined> {
  if (file.size > MAX_AI_UPLOAD_BYTES) {
    toast.error(
      `This file is ${formatFileSize(file.size)} — the AI reader can only handle files up to ${formatFileSize(MAX_AI_UPLOAD_BYTES)}. Try a lower-resolution scan, or split it into smaller files.`,
    );
    return undefined;
  }
  setBusy(true);
  setExtractSummary(null);
  let agencyName: string | undefined;
  try {
    const base64 = await readFileAsBase64(file);
    setForm((f) => ({ ...f, contractFileName: file.name, contractFileData: base64 }));

    const { data, error } = await supabase.functions.invoke<AgencyAgreementExtractResult>("extract-agency-agreement", {
      body: { fileBase64: base64, fileName: file.name, mimeType: file.type || "application/pdf" },
    });
    if (error) throw error;
    if (!data?.ok) {
      toast.error(data?.error || "Couldn't read this document");
      return undefined;
    }

    let fieldsFound = 0;
    agencyName = data.agency_name ?? undefined;
    setForm((f) => {
      const next = { ...f };
      if (data.management_fee_percent !== undefined && data.management_fee_percent !== null) {
        next.managementFeePercent = String(data.management_fee_percent);
        next.managementFeeGstInclusive = data.management_fee_gst_inclusive ?? false;
        fieldsFound++;
      }
      if (data.letting_fee_amount !== undefined && data.letting_fee_amount !== null) {
        next.lettingFeeAmount = String(data.letting_fee_amount);
        next.lettingFeeGstInclusive = data.letting_fee_gst_inclusive ?? false;
        fieldsFound++;
      }
      if (data.letting_fee_weeks_rent !== undefined && data.letting_fee_weeks_rent !== null) {
        next.lettingFeeWeeksRent = String(data.letting_fee_weeks_rent);
        next.lettingFeeGstInclusive = data.letting_fee_gst_inclusive ?? false;
        fieldsFound++;
      }
      if (data.admin_fee_amount !== undefined && data.admin_fee_amount !== null) {
        next.adminFeeAmount = String(data.admin_fee_amount);
        next.adminFeeGstInclusive = data.admin_fee_gst_inclusive ?? false;
        fieldsFound++;
      }
      if (data.admin_fee_frequency) {
        next.adminFeeFrequency = data.admin_fee_frequency;
        fieldsFound++;
      }
      if (data.lease_renewal_fee_amount !== undefined && data.lease_renewal_fee_amount !== null) {
        next.leaseRenewalFeeAmount = String(data.lease_renewal_fee_amount);
        next.leaseRenewalFeeGstInclusive = data.lease_renewal_fee_gst_inclusive ?? false;
        fieldsFound++;
      }
      if (data.inspection_fee_amount !== undefined && data.inspection_fee_amount !== null) {
        next.inspectionFeeAmount = String(data.inspection_fee_amount);
        next.inspectionFeeGstInclusive = data.inspection_fee_gst_inclusive ?? false;
        fieldsFound++;
      }
      if (data.inspections_per_year !== undefined && data.inspections_per_year !== null) {
        next.inspectionsPerYear = String(data.inspections_per_year);
        fieldsFound++;
      }
      if (data.advertising_fee_amount !== undefined && data.advertising_fee_amount !== null) {
        next.advertisingFeeAmount = String(data.advertising_fee_amount);
        next.advertisingFeeGstInclusive = data.advertising_fee_gst_inclusive ?? false;
        fieldsFound++;
      }
      if (data.lease_preparation_fee_amount !== undefined && data.lease_preparation_fee_amount !== null) {
        next.leasePreparationFeeAmount = String(data.lease_preparation_fee_amount);
        next.leasePreparationFeeGstInclusive = data.lease_preparation_fee_gst_inclusive ?? false;
        fieldsFound++;
      }
      if (data.ncat_fee_amount !== undefined && data.ncat_fee_amount !== null) {
        next.ncatFeeAmount = data.ncat_fee_amount;
        next.ncatFeeGstInclusive = data.ncat_fee_gst_inclusive ?? false;
        fieldsFound++;
      }
      if (data.agent_pays_water_usage !== undefined && data.agent_pays_water_usage !== null) {
        next.agentPaysWaterUsage = data.agent_pays_water_usage;
        fieldsFound++;
      }
      if (data.agent_pays_land_tax !== undefined && data.agent_pays_land_tax !== null) {
        next.agentPaysLandTax = data.agent_pays_land_tax;
        fieldsFound++;
      }
      if (data.agent_pays_council_rates !== undefined && data.agent_pays_council_rates !== null) {
        next.agentPaysCouncilRates = data.agent_pays_council_rates;
        fieldsFound++;
      }
      if (data.notice_period_days !== undefined && data.notice_period_days !== null) {
        next.noticePeriodDays = String(data.notice_period_days);
        fieldsFound++;
      }
      if (data.contract_start_date) {
        next.contractStartDate = data.contract_start_date;
        fieldsFound++;
      }
      if (data.contract_review_date) {
        next.contractReviewDate = data.contract_review_date;
        fieldsFound++;
      }
      return next;
    });

    if (fieldsFound === 0) {
      toast.warning("Couldn't find fee terms in this file — the fields below are ready for manual entry");
    } else {
      setExtractSummary({ fields: fieldsFound, confidence: data.confidence ?? 0 });
      toast.success("Extracted — review the fee terms before saving");
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Extraction failed");
  } finally {
    setBusy(false);
  }
  return agencyName;
}

/** One fee amount input plus its own "rate already includes GST" checkbox — a management
 * agreement can state some fees as "X% plus GST" and others as "$Y inclusive of GST" in the same
 * document, so each fee needs its own flag rather than one setting for the whole agreement (see
 * ProviderAgreement's `*GstInclusive` fields and feeVerification.ts's effectiveRate). */
function FeeAmountField({
  label,
  value,
  onChange,
  gstInclusive,
  onGstInclusiveChange,
  placeholder,
  inputType = "number",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  gstInclusive: boolean;
  onGstInclusiveChange: (v: boolean) => void;
  placeholder?: string;
  /** "text" for a fee that isn't always a flat number (e.g. an hourly-rate NCAT fee like
   * "$50/hour"), where forcing a numeric input would make it impossible to type. */
  inputType?: "number" | "text";
}) {
  return (
    <Field label={label}>
      <Input type={inputType} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      <label className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Checkbox
          checked={gstInclusive}
          onCheckedChange={(v) => onGstInclusiveChange(v === true)}
          className="h-3.5 w-3.5"
        />
        Rate already includes GST (unchecked = plus GST)
      </label>
    </Field>
  );
}

/** The fee-term fields + GST flag + contract upload, shared between ProviderDialog's Agreement
 * section and ProviderAgreementDialog — a plain presentational block, all state owned by the
 * caller, so both entry points render (and behave) identically. */
function AgreementFields({
  form,
  setForm,
  busy,
  extractSummary,
  onFileSelected,
}: {
  form: AgreementFormState;
  setForm: React.Dispatch<React.SetStateAction<AgreementFormState>>;
  busy: boolean;
  extractSummary: { fields: number; confidence: number } | null;
  onFileSelected: (file: File) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Input
          type="file"
          accept="application/pdf,image/*"
          className="h-8 text-xs"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFileSelected(f);
          }}
        />
        {busy && <span className="text-xs text-muted-foreground">Reading…</span>}
      </div>
      {form.contractFileName && (
        <div className="flex items-center justify-between gap-2 rounded bg-muted/50 px-2 py-1 text-xs">
          <span className="truncate">{form.contractFileName}</span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 shrink-0 gap-1 text-xs"
            onClick={() => openBillDocument(form.contractFileName, form.contractFileData)}
          >
            <Eye className="h-3 w-3" /> View
          </Button>
        </div>
      )}
      {extractSummary && (
        <div className="flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 px-2 py-1.5 text-xs text-emerald-900">
          <CheckCircle2 className="h-3 w-3 shrink-0" />
          Found {extractSummary.fields} fee term{extractSummary.fields === 1 ? "" : "s"} — review before saving.
          {extractSummary.confidence < 0.85 && " Low confidence — double-check every field."}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <FeeAmountField
          label="Management fee (%)"
          value={form.managementFeePercent}
          onChange={(v) => setForm((f) => ({ ...f, managementFeePercent: v }))}
          gstInclusive={form.managementFeeGstInclusive}
          onGstInclusiveChange={(v) => setForm((f) => ({ ...f, managementFeeGstInclusive: v }))}
          placeholder="e.g. 6.6"
        />
        <FeeAmountField
          label="Letting fee ($ flat)"
          value={form.lettingFeeAmount}
          onChange={(v) => setForm((f) => ({ ...f, lettingFeeAmount: v }))}
          gstInclusive={form.lettingFeeGstInclusive}
          onGstInclusiveChange={(v) => setForm((f) => ({ ...f, lettingFeeGstInclusive: v }))}
        />
        <Field label="— or letting fee (weeks' rent)">
          <Input
            type="number"
            value={form.lettingFeeWeeksRent}
            onChange={(e) => setForm((f) => ({ ...f, lettingFeeWeeksRent: e.target.value }))}
            placeholder="e.g. 1"
          />
        </Field>
        <FeeAmountField
          label="Admin / statement fee ($)"
          value={form.adminFeeAmount}
          onChange={(v) => setForm((f) => ({ ...f, adminFeeAmount: v }))}
          gstInclusive={form.adminFeeGstInclusive}
          onGstInclusiveChange={(v) => setForm((f) => ({ ...f, adminFeeGstInclusive: v }))}
        />
        <Field label="Admin fee frequency">
          <Select value={form.adminFeeFrequency} onValueChange={(v) => setForm((f) => ({ ...f, adminFeeFrequency: v }))}>
            <SelectTrigger>
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              {FEE_FREQUENCIES.map((f) => (
                <SelectItem key={f} value={f}>
                  {f}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <FeeAmountField
          label="Lease renewal fee ($)"
          value={form.leaseRenewalFeeAmount}
          onChange={(v) => setForm((f) => ({ ...f, leaseRenewalFeeAmount: v }))}
          gstInclusive={form.leaseRenewalFeeGstInclusive}
          onGstInclusiveChange={(v) => setForm((f) => ({ ...f, leaseRenewalFeeGstInclusive: v }))}
        />
        <FeeAmountField
          label="Inspection fee ($)"
          value={form.inspectionFeeAmount}
          onChange={(v) => setForm((f) => ({ ...f, inspectionFeeAmount: v }))}
          gstInclusive={form.inspectionFeeGstInclusive}
          onGstInclusiveChange={(v) => setForm((f) => ({ ...f, inspectionFeeGstInclusive: v }))}
        />
        <Field label="Inspections per year">
          <Input
            type="number"
            value={form.inspectionsPerYear}
            onChange={(e) => setForm((f) => ({ ...f, inspectionsPerYear: e.target.value }))}
            placeholder="e.g. 4"
          />
        </Field>
        <FeeAmountField
          label="Advertising / marketing fee ($)"
          value={form.advertisingFeeAmount}
          onChange={(v) => setForm((f) => ({ ...f, advertisingFeeAmount: v }))}
          gstInclusive={form.advertisingFeeGstInclusive}
          onGstInclusiveChange={(v) => setForm((f) => ({ ...f, advertisingFeeGstInclusive: v }))}
        />
        <FeeAmountField
          label="Lease preparation fee ($)"
          value={form.leasePreparationFeeAmount}
          onChange={(v) => setForm((f) => ({ ...f, leasePreparationFeeAmount: v }))}
          gstInclusive={form.leasePreparationFeeGstInclusive}
          onGstInclusiveChange={(v) => setForm((f) => ({ ...f, leasePreparationFeeGstInclusive: v }))}
        />
        <FeeAmountField
          label="NCAT / tribunal fee"
          value={form.ncatFeeAmount}
          onChange={(v) => setForm((f) => ({ ...f, ncatFeeAmount: v }))}
          gstInclusive={form.ncatFeeGstInclusive}
          onGstInclusiveChange={(v) => setForm((f) => ({ ...f, ncatFeeGstInclusive: v }))}
          inputType="text"
          placeholder="e.g. $50/hour, or $50/hr or flat $200"
        />
        <Field label="Notice period (days)">
          <Input
            type="number"
            value={form.noticePeriodDays}
            onChange={(e) => setForm((f) => ({ ...f, noticePeriodDays: e.target.value }))}
            placeholder="e.g. 30 or 60"
          />
        </Field>
        <Field label="Agreement start date">
          <Input
            type="date"
            value={form.contractStartDate}
            onChange={(e) => setForm((f) => ({ ...f, contractStartDate: e.target.value }))}
          />
        </Field>
        <Field label="Next review/renewal date">
          <Input
            type="date"
            value={form.contractReviewDate}
            onChange={(e) => setForm((f) => ({ ...f, contractReviewDate: e.target.value }))}
          />
        </Field>
        <div className="col-span-2 space-y-1.5 rounded border p-2">
          <div className="text-xs font-medium">Outgoings — does the agent pay these on the owner's behalf?</div>
          <label className="flex items-center gap-2 text-xs font-normal">
            <Checkbox
              checked={form.agentPaysWaterUsage}
              onCheckedChange={(v) => setForm((f) => ({ ...f, agentPaysWaterUsage: v === true }))}
            />
            Water Bill
          </label>
          <label className="flex items-center gap-2 text-xs font-normal">
            <Checkbox
              checked={form.agentPaysLandTax}
              onCheckedChange={(v) => setForm((f) => ({ ...f, agentPaysLandTax: v === true }))}
            />
            Land tax
          </label>
          <label className="flex items-center gap-2 text-xs font-normal">
            <Checkbox
              checked={form.agentPaysCouncilRates}
              onCheckedChange={(v) => setForm((f) => ({ ...f, agentPaysCouncilRates: v === true }))}
            />
            Council rates
          </label>
        </div>
        <div className="col-span-2">
          <Field label="Agreement notes">
            <Textarea
              value={form.contractNotes}
              onChange={(e) => setForm((f) => ({ ...f, contractNotes: e.target.value }))}
              rows={2}
              placeholder="Any other terms worth remembering — exclusivity period, marketing fee, etc."
            />
          </Field>
        </div>
      </div>
    </div>
  );
}

export function ProviderDialog({
  propertyId,
  provider,
  agreement,
  children,
  defaultRole,
}: {
  /** Unset creates/edits a portfolio-scoped contact with no Agreement section shown — the /providers
   * directory page uses this. The per-property Providers/Tenancy tabs always pass their own
   * propertyId, which shows the Agreement section alongside Contact. */
  propertyId?: string;
  provider?: Provider;
  /** The existing agreement to edit for (provider, propertyId), if any — leave unset when adding a
   * brand-new provider/agreement. Ignored when propertyId is unset. */
  agreement?: ProviderAgreement;
  children: React.ReactNode;
  /** Pre-selects the role on a brand-new contact (e.g. "Agent" from the Tenancy tab's "Add
   * managing agent" button) instead of always defaulting to "Other". Ignored when editing. */
  defaultRole?: ProviderRole;
}) {
  const { addProvider, updateProvider, addProviderAgreement, updateProviderAgreement, ensureProviderProperty, state } = useStore();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const propertyUnits = state.properties.find((p) => p.id === propertyId)?.units ?? [];
  const buildForm = () => ({
    name: provider?.name ?? "",
    role: provider?.role ?? defaultRole ?? ("Other" as ProviderRole),
    unitId: provider?.unitId ?? SHARED_UNIT,
    email: provider?.email ?? "",
    phone: provider?.phone ?? "",
    website: provider?.website ?? "",
    abn: provider?.abn ?? "",
    address: provider?.address ?? "",
    notes: provider?.notes ?? "",
    portalUrl: provider?.portalUrl ?? "",
    portalUsername: provider?.portalUsername ?? "",
    passwordNote: provider?.passwordNote ?? "",
    defaultCategory: provider?.defaultCategory ?? "",
  });
  const [form, setForm] = useState(buildForm);
  const [agreementForm, setAgreementForm] = useState<AgreementFormState>(() => agreementFormFrom(agreement));
  const [extractSummary, setExtractSummary] = useState<{ fields: number; confidence: number } | null>(null);

  const showAgreement = !!propertyId;

  const save = () => {
    if (!form.name.trim()) {
      toast.error("Name is required");
      return;
    }
    const payload = {
      name: form.name.trim(),
      role: form.role,
      unitId: form.unitId !== SHARED_UNIT ? form.unitId : undefined,
      email: form.email.trim() || undefined,
      phone: form.phone.trim() || undefined,
      website: form.website.trim() || undefined,
      abn: form.abn.trim() || undefined,
      address: form.address.trim() || undefined,
      notes: form.notes.trim() || undefined,
      portalUrl: form.portalUrl.trim() || undefined,
      portalUsername: form.portalUsername.trim() || undefined,
      passwordNote: form.passwordNote.trim() || undefined,
      defaultCategory: (form.defaultCategory || undefined) as ExpenseCategory | undefined,
    };
    // Creating a brand-new contact still dedups portfolio-wide by exact name (+ ABN, when both
    // sides have one) before creating a fresh identity row — the same real-world business added
    // from two different properties' Providers tabs should land on one Provider, not two. A found
    // match's existing identity fields are left untouched (only editing via the `provider` prop
    // updates them) — this is a reuse, not a merge.
    const existingByIdentity = !provider
      ? state.providers.find((p) => {
          if (p.name.trim().toLowerCase() !== form.name.trim().toLowerCase()) return false;
          const formAbn = form.abn.trim();
          if (formAbn && p.abn && p.abn.trim() !== formAbn) return false;
          return true;
        })
      : undefined;
    const providerId = provider ? provider.id : (existingByIdentity?.id ?? addProvider(payload));
    if (provider) {
      updateProvider(provider.id, payload);
    }

    if (showAgreement && propertyId) {
      const hasAnyAgreementField = Object.values(agreementPayloadFrom(agreementForm)).some((v) => v !== undefined && v !== false);
      if (agreement) {
        updateProviderAgreement(agreement.id, agreementPayloadFrom(agreementForm));
      } else if (hasAnyAgreementField) {
        addProviderAgreement({ providerId, propertyId, ...agreementPayloadFrom(agreementForm) });
      } else {
        ensureProviderProperty(providerId, propertyId);
      }
    }

    toast.success(provider ? "Contact updated" : "Contact added");
    setOpen(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setForm(buildForm());
          setAgreementForm(agreementFormFrom(agreement));
          setExtractSummary(null);
        }
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{provider ? "Edit contact" : "Add contact"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name">
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </Field>
          <Field label="Role">
            <Select value={form.role} onValueChange={(v) => setForm((f) => ({ ...f, role: v as ProviderRole }))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDER_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {PROVIDER_ROLE_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {propertyUnits.length > 0 && (
            <Field label="Dwelling">
              <Select value={form.unitId} onValueChange={(v) => setForm((f) => ({ ...f, unitId: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SHARED_UNIT}>Whole property</SelectItem>
                  {propertyUnits.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field label="Email">
            <Input value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
          </Field>
          <Field label="Phone">
            <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
          </Field>
          <Field label="Website">
            <Input value={form.website} onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))} />
          </Field>
          <Field label="ABN">
            <Input value={form.abn} onChange={(e) => setForm((f) => ({ ...f, abn: e.target.value }))} />
          </Field>
          <Field label="Default category">
            <Select
              value={form.defaultCategory || "__none__"}
              onValueChange={(v) => setForm((f) => ({ ...f, defaultCategory: v === "__none__" ? "" : v }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">—</SelectItem>
                {EXPENSE_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="col-span-2">
            <Field label="Address">
              <Input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
            </Field>
          </div>
          <Field label="Portal URL">
            <Input value={form.portalUrl} onChange={(e) => setForm((f) => ({ ...f, portalUrl: e.target.value }))} placeholder="https://…" />
          </Field>
          <Field label="Portal username">
            <Input value={form.portalUsername} onChange={(e) => setForm((f) => ({ ...f, portalUsername: e.target.value }))} />
          </Field>
          <div className="col-span-2">
            <Field label="Password note (stored locally)">
              <Input value={form.passwordNote} onChange={(e) => setForm((f) => ({ ...f, passwordNote: e.target.value }))} />
            </Field>
          </div>
          <div className="col-span-2">
            <Field label="Notes">
              <Textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={2} />
            </Field>
          </div>
        </div>

        {showAgreement && form.role === "Agent" && (
          <div className="col-span-2 space-y-3 rounded-md border p-3">
            <div className="text-xs font-medium">Management agreement — this property</div>
            <AgreementFields
              form={agreementForm}
              setForm={setAgreementForm}
              busy={busy}
              extractSummary={extractSummary}
              onFileSelected={(file) =>
                void extractAgreementFile(file, setAgreementForm, setBusy, setExtractSummary).then((agencyName) => {
                  if (agencyName && !form.name.trim()) setForm((f) => ({ ...f, name: agencyName }));
                })
              }
            />
          </div>
        )}

        <DialogFooter>
          <Button onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Adds or edits a single ProviderAgreement for an existing provider — used from the provider
 * profile page's "Agreements" section (Issue 1), where the contact identity already exists and
 * only the per-property agreement terms need a picker + the shared fee-term fields. Editing an
 * existing agreement fixes the property (an agreement can't be moved to a different property —
 * add a new one there instead). */
export function ProviderAgreementDialog({
  providerId,
  agreement,
  children,
}: {
  providerId: string;
  agreement?: ProviderAgreement;
  children: React.ReactNode;
}) {
  const { state, addProviderAgreement, updateProviderAgreement } = useStore();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [propertyId, setPropertyId] = useState(agreement?.propertyId ?? "");
  const [form, setForm] = useState<AgreementFormState>(() => agreementFormFrom(agreement));
  const [extractSummary, setExtractSummary] = useState<{ fields: number; confidence: number } | null>(null);

  const save = () => {
    if (!propertyId) return toast.error("Select a property first");
    if (agreement) {
      updateProviderAgreement(agreement.id, agreementPayloadFrom(form));
      toast.success("Agreement updated");
    } else {
      addProviderAgreement({ providerId, propertyId, ...agreementPayloadFrom(form) });
      toast.success("Agreement added");
    }
    setOpen(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setPropertyId(agreement?.propertyId ?? "");
          setForm(agreementFormFrom(agreement));
          setExtractSummary(null);
        }
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{agreement ? "Edit agreement" : "Add agreement"}</DialogTitle>
        </DialogHeader>
        <Field label="Property">
          {agreement ? (
            <div className="text-sm">
              {(() => {
                const p = state.properties.find((x) => x.id === agreement.propertyId);
                return p?.alias || p?.address || "Unknown property";
              })()}
            </div>
          ) : (
            <Select value={propertyId} onValueChange={setPropertyId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a property…" />
              </SelectTrigger>
              <SelectContent>
                {state.properties.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.alias || p.address}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Field>
        <AgreementFields
          form={form}
          setForm={setForm}
          busy={busy}
          extractSummary={extractSummary}
          onFileSelected={(file) => void extractAgreementFile(file, setForm, setBusy, setExtractSummary)}
        />
        <DialogFooter>
          <Button onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ProviderRow({
  provider,
  propertyId,
  agreement,
  linkToProfile,
}: {
  provider: Provider;
  /** The property context this row is being shown in, if any — passed through to ProviderDialog
   * so editing shows the right Agreement section. Unset on the portfolio-wide /providers page. */
  propertyId?: string;
  /** This provider's resolved agreement for `propertyId`, if any — fee terms/contract file render
   * from here instead of directly off the provider (identity no longer carries agreement fields). */
  agreement?: ProviderAgreement;
  /** Makes the name/details block a link to this provider's own profile page (payment history,
   * every linked property, agreements) — the same click-through the portfolio-wide /providers list
   * already has. Left off on the provider's own profile page itself (providers_.$providerId.tsx),
   * where this row IS that page and linking to itself would be a no-op. */
  linkToProfile?: boolean;
}) {
  const { deleteProvider } = useStore();
  const details = [provider.email, provider.phone, provider.website].filter(Boolean).join(" · ");
  return (
    <div className="flex items-start justify-between gap-2 rounded border p-2 text-xs">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {linkToProfile ? (
            <Link to="/providers/$providerId" params={{ providerId: provider.id }} className="font-medium hover:underline">
              {provider.name}
            </Link>
          ) : (
            <span className="font-medium">{provider.name}</span>
          )}
          <Badge variant="secondary" className="text-[10px]">
            {PROVIDER_ROLE_LABELS[provider.role] ?? provider.role}
          </Badge>
        </div>
        {details && <div className="mt-0.5 text-muted-foreground">{details}</div>}
        {provider.address && <div className="text-muted-foreground">{provider.address}</div>}
        {provider.abn && <div className="text-muted-foreground">ABN {provider.abn}</div>}
        {provider.portalUrl && (
          <a href={provider.portalUrl} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-primary">
            Open portal <ExternalLink className="h-3 w-3" />
          </a>
        )}
        {(provider.portalUsername || provider.passwordNote) && (
          <div className="text-muted-foreground">
            {provider.portalUsername && <>User: <span className="font-mono">{provider.portalUsername}</span></>}
            {provider.passwordNote && <> • Note: <span className="font-mono">{provider.passwordNote}</span></>}
          </div>
        )}
        {provider.role === "Agent" && agreement && hasFeeTerms(agreement) && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-muted-foreground">
            {agreement.managementFeePercent !== undefined && <span>Mgmt fee {agreement.managementFeePercent}%</span>}
            {agreement.lettingFeeAmount !== undefined && <span>Letting {fmtCurrency(agreement.lettingFeeAmount)}</span>}
            {agreement.lettingFeeWeeksRent !== undefined && <span>Letting {agreement.lettingFeeWeeksRent} wk rent</span>}
            {agreement.adminFeeAmount !== undefined && <span>Admin {fmtCurrency(agreement.adminFeeAmount)}</span>}
            {agreement.advertisingFeeAmount !== undefined && <span>Advertising {fmtCurrency(agreement.advertisingFeeAmount)}</span>}
            {agreement.noticePeriodDays !== undefined && <span>Notice {agreement.noticePeriodDays} days</span>}
            {agreement.contractFileData && (
              <button
                type="button"
                onClick={() => openBillDocument(agreement.contractFileName, agreement.contractFileData)}
                className="inline-flex items-center gap-1 text-primary underline"
              >
                <FileText className="h-3 w-3" /> Agreement
              </button>
            )}
          </div>
        )}
        {provider.notes && <div className="mt-1 whitespace-pre-wrap">{provider.notes}</div>}
      </div>
      <div className="flex shrink-0 gap-1">
        <ProviderDialog propertyId={propertyId} provider={provider} agreement={agreement}>
          <Button size="icon" variant="ghost" className="h-6 w-6">
            <Pencil className="h-3 w-3" />
          </Button>
        </ProviderDialog>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          onClick={() => {
            if (confirm(`Delete contact "${provider.name}"? This also removes every agreement and document on file for them.`)) {
              deleteProvider(provider.id);
              toast.success("Contact deleted");
            }
          }}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

/**
 * The property's managing-agent relationship, front and centre — the signed agreement upload,
 * the agency's contact details and every fee term read off it (all of what ProviderRow already
 * shows for an Agent-role Provider), plus the fee-verification report right underneath since it's
 * checking the same agreement. Previously this only lived nested inside the generic Providers
 * contact list, which a landlord adding a managing agent had no obvious reason to go looking in.
 */
export function PropertyTenancyTab({ propertyId }: { propertyId: string }) {
  const { state } = useStore();
  // A property's "agents" are Agent-role providers tagged to it via provider_properties — not
  // every one of those necessarily has an agreement on file yet (see the "no fee terms" message
  // below), so this deliberately isn't filtered down to providers with a provider_agreements row.
  const agentProviderIds = new Set(
    state.providerProperties.filter((pp) => pp.propertyId === propertyId).map((pp) => pp.providerId),
  );
  const agreementFor = (providerId: string) => latestAgreementFor(state.providerAgreements, providerId, propertyId);
  const agents = [...state.providers.filter((p) => agentProviderIds.has(p.id) && p.role === "Agent")].sort((a, b) => {
    const aStart = agreementFor(a.id)?.contractStartDate ?? a.created_at ?? "";
    const bStart = agreementFor(b.id)?.contractStartDate ?? b.created_at ?? "";
    return bStart.localeCompare(aStart);
  });
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const selectedAgent = agents.find((a) => a.id === selectedAgentId) ?? agents[0];
  const selectedAgreement = selectedAgent ? agreementFor(selectedAgent.id) : undefined;
  const [reviewProposalId, setReviewProposalId] = useState<string | null>(null);

  const statements = state.aiProposals.filter((p) => p.propertyId === propertyId && p.kind === "rent_ledger");
  // Rent statements already get their own richer, review-capable section below
  // (AgentStatementsSection) — this generic list only needs to cover lease/tenant documents that
  // don't have one.
  const tenancyDocuments = buildDocumentEntries(state).filter(
    (e) => e.propertyId === propertyId && (e.kind === "Lease Agreement" || e.kind === "Tenant Document"),
  );
  const tenantsAtPropertyOptions = state.tenants
    .filter((t) => t.propertyId === propertyId)
    .map((t) => ({ id: t.id, name: t.name }));

  return (
    <div className="space-y-5 text-sm">
      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-medium">Managing agent{agents.length > 1 ? "s" : ""}</div>
            <div className="text-xs text-muted-foreground">
              Upload the signed management agreement to auto-fill the agency's contact details and fee terms. Add a
              new one when you switch agents — a past agent's contract and fee terms stay on file rather than being
              overwritten.
            </div>
          </div>
          <ProviderDialog propertyId={propertyId} defaultRole="Agent">
            <Button size="sm" variant="outline" className="shrink-0 gap-1">
              <Plus className="h-3.5 w-3.5" /> Add managing agent
            </Button>
          </ProviderDialog>
        </div>
        {agents.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground">
            No managing agent on file for this property yet.
          </div>
        ) : (
          <div className="space-y-2">
            {agents.map((a) => (
              <ProviderRow key={a.id} provider={a} propertyId={propertyId} agreement={agreementFor(a.id)} />
            ))}
          </div>
        )}
      </div>

      {agents.length > 0 && (
        <div className="border-t pt-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium">Fee verification</div>
            {agents.length > 1 && selectedAgent && (
              <Select value={selectedAgent.id} onValueChange={setSelectedAgentId}>
                <SelectTrigger className="h-7 w-[220px] text-xs">
                  <SelectValue placeholder="Verify against…" />
                </SelectTrigger>
                <SelectContent>
                  {agents.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                      {agreementFor(a.id)?.contractStartDate ? ` (from ${agreementFor(a.id)?.contractStartDate})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          {selectedAgent && (
            <PropertyFeeVerificationTab propertyId={propertyId} provider={selectedAgent} agreement={selectedAgreement} />
          )}
        </div>
      )}

      <div className="border-t pt-4">
        <AgentStatementsSection statements={statements} onReview={setReviewProposalId} tenantOptions={tenantsAtPropertyOptions} />
      </div>

      <div className="border-t pt-4">
        <OwnerLedgerSection propertyId={propertyId} tenantOptions={tenantsAtPropertyOptions} />
      </div>

      <div className="border-t pt-4">
        <DocumentsPanel title="Lease & tenant documents" entries={tenancyDocuments} tenantOptions={tenantsAtPropertyOptions} />
      </div>

      <ProposalReviewDialog
        proposalId={reviewProposalId}
        onOpenChange={(v) => {
          if (!v) setReviewProposalId(null);
        }}
      />
    </div>
  );
}

/**
 * Every rent statement ("agent statement") uploaded/emailed for this property, with the same
 * search/FY/group-by filters as the portfolio-wide Documents page — kept here too since a
 * statement's own fee-verification relevance makes it worth finding without leaving Tenancy.
 */
type StatementSortField = "period" | "added" | "file";

function AgentStatementsSection({
  statements,
  onReview,
  tenantOptions,
}: {
  statements: AiIntakeProposal[];
  onReview: (proposalId: string) => void;
  tenantOptions?: { id: string; name: string }[];
}) {
  const [query, setQuery] = useState("");
  const [fy, setFy] = useState("all");
  const [groupBy, setGroupBy] = useState<"none" | "month" | "fy">("none");
  const [fileFormat, setFileFormat] = useState<"__all__" | FileFormat>("__all__");
  const [tenantId, setTenantId] = useState("__all__");
  // Newest-added on top by default — the point of a review queue is seeing what just landed.
  const [sort, setSort] = useState<SortState<StatementSortField>>({ field: "added", dir: "desc" });

  const fys = buildFyOptions();

  const periodOf = (p: AiIntakeProposal) =>
    (p.payload as RentLedgerProposalPayload).periodStart ?? p.documentDate ?? p.created_at?.slice(0, 10) ?? "";

  // On a changeover statement, the statement's OWN overall tenantName is often left blank —
  // per-line tenantName is set instead, one per transaction, since a changeover statement spans
  // more than one tenant (see RentLedgerProposalPayload.transactions[].tenantName). Every tenant
  // filter/search/display below has to look at both, or a changeover statement (or one where the
  // top-level field was never populated for any reason) becomes invisible to a tenant filter and
  // shows no name of its own in the list.
  const tenantNamesOf = (payload: RentLedgerProposalPayload): string[] => {
    if (payload.tenantName) return [payload.tenantName];
    const names = new Set(payload.transactions?.map((t) => t.tenantName).filter((n): n is string => !!n) ?? []);
    return [...names];
  };

  const { start, end } = fy === "all" ? { start: "", end: "" } : fyRange(fy);
  const filtered = statements.filter((p) => {
    const payload = p.payload as RentLedgerProposalPayload;
    const names = tenantNamesOf(payload);
    const date = periodOf(p);
    if (fy !== "all" && !(date >= start && date <= end)) return false;
    if (fileFormat !== "__all__" && fileFormatOf({ fileName: p.sourceFileName, fileData: p.sourceFileData, emailBody: p.sourceEmailBody }) !== fileFormat) return false;
    if (tenantId !== "__all__") {
      // matchedTenantId is only ever set once a statement has actually been reviewed/applied —
      // most statements (especially still-pending ones) have it unset, which would otherwise
      // make this filter hide everyone regardless of which tenant was picked. Fall back to the
      // statement's own extracted tenant name(s) against the selected tenant's real name so the
      // filter still works before that match has been made.
      const selectedTenantName = tenantOptions?.find((t) => t.id === tenantId)?.name;
      // Exact (trimmed, case-insensitive) match — `names` are whole extracted tenant names, not
      // free text, so `includes` here would also match a different tenant whose name happens to be
      // a substring of this one (e.g. filtering by "Jo Smith" would wrongly also match "Jo Smithson").
      const matchesByName = !!selectedTenantName && names.some((n) => n.trim().toLowerCase() === selectedTenantName.trim().toLowerCase());
      if (p.matchedTenantId !== tenantId && !matchesByName) return false;
    }
    if (query) {
      const haystack = `${names.join(" ")} ${payload.periodStart ?? ""} ${payload.periodEnd ?? ""} ${p.sourceFileName ?? ""}`.toLowerCase();
      if (!haystack.includes(query.toLowerCase())) return false;
    }
    return true;
  });

  const sortValueOf = (p: AiIntakeProposal, field: StatementSortField): string => {
    if (field === "period") return periodOf(p);
    if (field === "added") return p.created_at ?? "";
    return (p.sourceFileName ?? "").toLowerCase();
  };
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av = sortValueOf(a, sort.field);
      const bv = sortValueOf(b, sort.field);
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sort]);

  // Grouping still orders newest-period-group-first regardless of the row-level sort above —
  // `sorted`'s order is preserved *within* each group either way.
  const groups = useMemo(() => {
    if (groupBy === "none") return null;
    const map = bucketBy(sorted, (p) => {
      const date = periodOf(p);
      return !date ? "unknown" : groupBy === "month" ? date.slice(0, 7) : ausFinancialYear(date);
    });
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [sorted, groupBy]);

  const StatementRow = (p: AiIntakeProposal) => {
    const payload = p.payload as RentLedgerProposalPayload;
    const names = tenantNamesOf(payload);
    return (
      <tr key={p.id} className="border-b text-xs last:border-b-0">
        <td className="px-3 py-2 whitespace-nowrap font-medium">
          {payload.periodStart || "—"} → {payload.periodEnd || "—"}
        </td>
        <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{fmtModified(p.created_at) ?? "—"}</td>
        <td className="min-w-0 max-w-[220px] truncate px-3 py-2 text-muted-foreground" title={p.sourceFileName ?? undefined}>
          {p.sourceFileName || "—"}
        </td>
        <td className="px-3 py-2 text-muted-foreground">{names.length > 0 ? names.join(", ") : "—"}</td>
        <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
          {payload.netToOwner !== undefined ? fmtCurrency(payload.netToOwner) : "—"}
        </td>
        <td className="px-3 py-2">
          <Badge variant={p.status === "pending" ? "outline" : p.status === "dismissed" ? "secondary" : "default"} className="text-[10px]">
            {p.status}
          </Badge>
        </td>
        <td className="px-3 py-2">
          <div className="flex items-center justify-end gap-1">
            {p.sourceFileData && (
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                title="View document"
                onClick={() => openBillDocument(p.sourceFileName, p.sourceFileData)}
              >
                <Eye className="h-3 w-3" />
              </Button>
            )}
            {p.status === "pending" && (
              <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => onReview(p.id)}>
                Review
              </Button>
            )}
          </div>
        </td>
      </tr>
    );
  };

  const onSort = (field: StatementSortField) => setSort((s) => toggleSort(s, field));
  const StatementTableHead = () => (
    <thead>
      <tr className="border-b text-left text-xs text-muted-foreground">
        <SortableTh field="period" label="Period" sort={sort} onSort={onSort} />
        <SortableTh field="added" label="Added" sort={sort} onSort={onSort} />
        <SortableTh field="file" label="File name" sort={sort} onSort={onSort} />
        <th className="px-3 py-2 text-left font-medium">Tenant(s)</th>
        <th className="px-3 py-2 text-left font-medium">Net</th>
        <th className="px-3 py-2 text-left font-medium">Status</th>
        <th className="px-3 py-2" />
      </tr>
    </thead>
  );

  return (
    <div>
      <div className="mb-2 text-sm font-medium">Agent statements</div>
      {statements.length === 0 ? (
        <div className="text-xs text-muted-foreground">
          No rent statements uploaded for this property yet — forward or upload one and it'll show up here.
        </div>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Input
              placeholder="Search statements…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-7 w-[180px] text-xs"
            />
            <Select value={fy} onValueChange={setFy}>
              <SelectTrigger className="h-7 w-[130px] text-xs">
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
              <SelectTrigger className="h-7 w-[150px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No grouping</SelectItem>
                <SelectItem value="month">By month</SelectItem>
                <SelectItem value="fy">By financial year</SelectItem>
              </SelectContent>
            </Select>
            <Select value={fileFormat} onValueChange={(v) => setFileFormat(v as typeof fileFormat)}>
              <SelectTrigger className="h-7 w-[130px] text-xs">
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
            {tenantOptions && tenantOptions.length > 0 && (
              <Select value={tenantId} onValueChange={setTenantId}>
                <SelectTrigger className="h-7 w-[150px] text-xs">
                  <SelectValue placeholder="All tenants" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All tenants</SelectItem>
                  {tenantOptions.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {sorted.length === 0 ? (
            <div className="text-xs text-muted-foreground">No statements match these filters.</div>
          ) : (
            <div className="overflow-x-auto rounded border">
              <table className="w-full text-sm">
                <StatementTableHead />
                <tbody>
                  {groupBy === "none" || !groups
                    ? sorted.map((p) => StatementRow(p))
                    : groups.flatMap(([key, rows]) => [
                        <tr key={`${key}-hdr`} className="border-b bg-muted/40">
                          <td colSpan={7} className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                            {key === "unknown" ? "Unknown period" : groupBy === "month" ? feeVerificationMonthLabel(key) : `FY ${key}`}
                          </td>
                        </tr>,
                        ...rows.map((p) => StatementRow(p)),
                      ])}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

interface OwnerLedgerRow {
  id: string;
  date: string;
  description: string;
  category?: string;
  tenantName?: string;
  moneyIn: number;
  moneyOut: number;
  balance: number;
  sourceFileName?: string | null;
  sourceFileData?: string | null;
}

/**
 * Rebuilds the managing agent's own "ownership statement" running ledger from what's actually
 * been posted to this property — every ledger_entries/expenses row with `source: "agent_statement"`
 * (i.e. confirmed from a reviewed rent statement, not a manual entry or bank-feed line), in one
 * chronological running-balance view. This is deliberately scoped to agent-statement-sourced rows
 * only — the portfolio-wide Transactions ledger already shows everything regardless of source; the
 * point here is to let the landlord check this property's own numbers against what the agent
 * reports, the same way they'd read the agent's PDF statement.
 */
type OwnerLedgerSortField = "date" | "in" | "out" | "balance";

function OwnerLedgerSection({ propertyId, tenantOptions }: { propertyId: string; tenantOptions?: { id: string; name: string }[] }) {
  const { state } = useStore();
  const [query, setQuery] = useState("");
  const [fy, setFy] = useState("all");
  const [groupBy, setGroupBy] = useState<"none" | "month" | "fy">("none");
  const [tenantId, setTenantId] = useState("__all__");
  // Newest first by default, matching every other list in this app.
  const [sort, setSort] = useState<SortState<OwnerLedgerSortField>>({ field: "date", dir: "desc" });
  const fys = buildFyOptions();

  const tenantsAtProperty = state.tenants.filter((t) => t.propertyId === propertyId);
  const tenantNameById = new Map(tenantsAtProperty.map((t) => [t.id, t.name]));

  const rows: OwnerLedgerRow[] = useMemo(() => {
    const income: OwnerLedgerRow[] = state.ledger
      .filter((l) => l.source === "agent_statement" && tenantNameById.has(l.tenantId))
      .map((l) => ({
        id: `l_${l.id}`,
        date: l.date,
        description: l.description || l.type,
        tenantName: tenantNameById.get(l.tenantId),
        moneyIn: l.credit,
        moneyOut: l.debit,
        balance: 0,
        sourceFileName: l.sourceFileName,
        sourceFileData: l.sourceFileData,
      }));
    const outgoings: OwnerLedgerRow[] = state.expenses
      .filter((e) => e.source === "agent_statement" && e.propertyId === propertyId)
      .map((e) => ({
        id: `e_${e.id}`,
        date: e.date,
        description: e.itemName,
        category: e.category,
        tenantName: e.tenantId ? tenantNameById.get(e.tenantId) : undefined,
        moneyIn: 0,
        moneyOut: e.cost,
        balance: 0,
        sourceFileName: e.sourceFileName,
        sourceFileData: e.sourceFileData,
      }));
    // Running balance is computed chronologically (oldest first) over the FULL unfiltered set —
    // it reflects this property's true cumulative position, same as a bank statement still shows
    // the real balance on a line even once you've filtered/searched down to fewer rows.
    const chronological = [...income, ...outgoings].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    let running = 0;
    for (const r of chronological) {
      running += r.moneyIn - r.moneyOut;
      r.balance = running;
    }
    return chronological;
  }, [state.ledger, state.expenses, propertyId, tenantNameById]);

  const { start, end } = fy === "all" ? { start: "", end: "" } : fyRange(fy);
  const filtered = rows.filter((r) => {
    if (fy !== "all" && !(r.date >= start && r.date <= end)) return false;
    if (tenantId !== "__all__" && r.tenantName !== tenantOptions?.find((t) => t.id === tenantId)?.name) return false;
    if (query && !`${r.description} ${r.category ?? ""} ${r.tenantName ?? ""}`.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });
  // The running balance on each row was already fixed above from the true chronological pass —
  // sorting here is purely a display-order choice and never touches those numbers.
  const sortValueOf = (r: OwnerLedgerRow, field: OwnerLedgerSortField): number | string => {
    if (field === "date") return r.date;
    if (field === "in") return r.moneyIn;
    if (field === "out") return r.moneyOut;
    return r.balance;
  };
  const display = [...filtered].sort((a, b) => {
    const av = sortValueOf(a, sort.field);
    const bv = sortValueOf(b, sort.field);
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return sort.dir === "asc" ? cmp : -cmp;
  });

  const groups = useMemo(() => {
    if (groupBy === "none") return null;
    const map = bucketBy(display, (r) => (groupBy === "month" ? r.date.slice(0, 7) : ausFinancialYear(r.date)));
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [display, groupBy]);

  const totalIn = filtered.reduce((s, r) => s + r.moneyIn, 0);
  const totalOut = filtered.reduce((s, r) => s + r.moneyOut, 0);

  const exportCsv = () => {
    downloadCsv(
      `owner-ledger-${propertyId}.csv`,
      ["Date", "Description", "Tenant", "Money in", "Money out", "Balance", "Statement"],
      filtered.map((r) => [r.date, r.description, r.tenantName ?? "", r.moneyIn, -r.moneyOut, r.balance, r.sourceFileName ?? ""]),
    );
  };

  const Row = (r: OwnerLedgerRow) => (
    <tr key={r.id} className="border-b text-xs last:border-b-0">
      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{r.date}</td>
      <td className="min-w-0 max-w-[260px] truncate px-3 py-2 font-medium" title={r.description}>
        {r.description}
      </td>
      <td className="px-3 py-2 text-muted-foreground">{r.tenantName ?? "—"}</td>
      <td className="px-3 py-2">
        {r.category ? (
          <Badge variant="outline" className="text-[10px]">
            {r.category}
          </Badge>
        ) : (
          "—"
        )}
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-right text-emerald-700">{r.moneyIn > 0 ? `+${fmtCurrency(r.moneyIn)}` : "—"}</td>
      <td className="px-3 py-2 whitespace-nowrap text-right text-destructive">{r.moneyOut > 0 ? `−${fmtCurrency(r.moneyOut)}` : "—"}</td>
      <td className="px-3 py-2 whitespace-nowrap text-right font-medium">{fmtCurrency(r.balance)}</td>
      <td className="min-w-0 max-w-[200px] px-3 py-2">
        {r.sourceFileName ? (
          r.sourceFileData ? (
            <button
              type="button"
              className="flex w-full min-w-0 items-center gap-1 truncate text-left text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground"
              title={r.sourceFileName}
              onClick={() => openBillDocument(r.sourceFileName ?? undefined, r.sourceFileData ?? undefined)}
            >
              <Eye className="h-3 w-3 shrink-0" />
              <span className="truncate">{r.sourceFileName}</span>
            </button>
          ) : (
            <span className="block truncate text-muted-foreground" title={r.sourceFileName}>
              {r.sourceFileName}
            </span>
          )
        ) : (
          "—"
        )}
      </td>
    </tr>
  );

  const onSort = (field: OwnerLedgerSortField) => setSort((s) => toggleSort(s, field));
  const OwnerLedgerTableHead = () => (
    <thead>
      <tr className="border-b text-left text-xs text-muted-foreground">
        <SortableTh field="date" label="Date" sort={sort} onSort={onSort} />
        <th className="px-3 py-2 text-left font-medium">Description</th>
        <th className="px-3 py-2 text-left font-medium">Tenant</th>
        <th className="px-3 py-2 text-left font-medium">Category</th>
        <SortableTh field="in" label="Money in" align="right" sort={sort} onSort={onSort} />
        <SortableTh field="out" label="Money out" align="right" sort={sort} onSort={onSort} />
        <SortableTh field="balance" label="Balance" align="right" sort={sort} onSort={onSort} />
        <th className="px-3 py-2 text-left font-medium">Statement</th>
      </tr>
    </thead>
  );

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium">Owner ledger (as reported by managing agent)</div>
        {rows.length > 0 && (
          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={exportCsv}>
            <Download className="h-3.5 w-3.5" /> Export CSV
          </Button>
        )}
      </div>
      {rows.length === 0 ? (
        <div className="text-xs text-muted-foreground">
          Nothing posted from an agent statement yet — apply a reviewed rent statement above and it'll show up here.
        </div>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Input
              placeholder="Search description…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-7 w-[180px] text-xs"
            />
            <Select value={fy} onValueChange={setFy}>
              <SelectTrigger className="h-7 w-[130px] text-xs">
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
              <SelectTrigger className="h-7 w-[150px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No grouping</SelectItem>
                <SelectItem value="month">By month</SelectItem>
                <SelectItem value="fy">By financial year</SelectItem>
              </SelectContent>
            </Select>
            {tenantOptions && tenantOptions.length > 1 && (
              <Select value={tenantId} onValueChange={setTenantId}>
                <SelectTrigger className="h-7 w-[150px] text-xs">
                  <SelectValue placeholder="All tenants" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All tenants</SelectItem>
                  {tenantOptions.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <span className="text-xs text-muted-foreground">
              In {fmtCurrency(totalIn)} · Out {fmtCurrency(totalOut)} · Net {fmtCurrency(totalIn - totalOut)}
            </span>
          </div>

          {display.length === 0 ? (
            <div className="text-xs text-muted-foreground">No entries match these filters.</div>
          ) : (
            <div className="overflow-x-auto rounded border">
              <table className="w-full text-sm">
                <OwnerLedgerTableHead />
                <tbody>
                  {groupBy === "none" || !groups
                    ? display.map((r) => Row(r))
                    : groups.flatMap(([key, groupRows]) => [
                        <tr key={`${key}-hdr`} className="border-b bg-muted/40">
                          <td colSpan={8} className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                            {groupBy === "month" ? feeVerificationMonthLabel(key) : `FY ${key}`}
                          </td>
                        </tr>,
                        ...groupRows.map((r) => Row(r)),
                      ])}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function feeVerificationMonthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-AU", { month: "short", year: "numeric" });
}

/**
 * On-demand fee-verification report for one property — a month-by-month breakdown of rent
 * collected against every posted expense paid to this agent (see isAgentFeeExpense — category
 * "Property Agent Fees"/"Letting Fees", or simply payee = the agent's name) within a chosen
 * financial year (or all time), each month checked against the given provider's management-
 * agreement terms.
 *
 * Management Fee and Letting Fee are genuinely per-period/per-transaction charges, so they're
 * computed once per month (verifyAgentFees, restricted to just those two types) and summed —
 * mathematically identical to computing them once for the whole span. Admin Fee, Lease Renewal Fee
 * and Inspection Fee are flat contracted amounts, not a per-period charge — comparing the same raw
 * contracted amount against every month it happens to recur in would re-add it as "expected" each
 * time and overstate the true annual figure, so those three are reconciled once for the whole
 * selected span instead (reconcileFlatFees), not accumulated per month.
 */
export function PropertyFeeVerificationTab({
  propertyId,
  provider,
  agreement,
}: {
  propertyId: string;
  provider: Provider;
  agreement?: ProviderAgreement;
}) {
  const { state } = useStore();
  const currentFY = ausFinancialYear(todayISO());
  const [fy, setFy] = useState(currentFY);
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());

  const fys = buildFyOptions();

  if (!agreement || !hasFeeTerms(agreement)) {
    return (
      <div className="text-sm text-muted-foreground">
        {provider.name} has no management-agreement fee terms on file yet — upload the signed agreement above (or
        enter the fees manually) to enable verification.
      </div>
    );
  }
  const agreementTerms: AgreementFeeTerms = agreement;

  const { start, end } = fy === "all" ? { start: "0000-01-01", end: "9999-12-31" } : fyRange(fy);
  const tenantIds = state.tenants.filter((t) => t.propertyId === propertyId).map((t) => t.id);
  const rentInRange = state.ledger.filter(
    (e) => tenantIds.includes(e.tenantId) && e.type === "Rent Payment" && e.date >= start && e.date <= end,
  );
  const expensesInRange = state.expenses.filter(
    (e) => e.propertyId === propertyId && e.date >= start && e.date <= end && isAgentFeeExpense(e, provider.name),
  );
  // "Per Statement" admin-fee annualization needs how many rent statements actually came in over
  // the span — every real statement gets uploaded/emailed in as a rent_ledger proposal.
  const statementCount = state.aiProposals.filter((p) => {
    if (p.propertyId !== propertyId || p.kind !== "rent_ledger" || p.status === "dismissed") return false;
    const date = (p.payload as RentLedgerProposalPayload).periodStart ?? p.documentDate ?? p.created_at?.slice(0, 10) ?? "";
    return date >= start && date <= end;
  }).length;

  const monthKeys = [...new Set([...rentInRange.map((e) => e.date.slice(0, 7)), ...expensesInRange.map((e) => e.date.slice(0, 7))])].sort();

  const monthRows = monthKeys.map((key) => {
    const monthRent = rentInRange.filter((e) => e.date.slice(0, 7) === key);
    const rentCollected = monthRent.reduce((s, e) => s + e.credit, 0);
    // A letting fee contracted as "N weeks' rent" needs the actual tenant's weekly rent to convert
    // to a dollar figure — resolved from whichever tenant's rent payment(s) make up this month's
    // total, the same "unambiguous single tenant" resolution RentLedgerProposalCard's feeChecks
    // uses (singleAssignedTenant) rather than guessing when more than one tenant paid in the month.
    const monthTenantIds = [...new Set(monthRent.map((e) => e.tenantId))];
    const monthTenant = monthTenantIds.length === 1 ? state.tenants.find((t) => t.id === monthTenantIds[0]) : undefined;
    const lines = collectAgentFeeLines(expensesInRange.filter((e) => e.date.slice(0, 7) === key));
    const results = verifyAgentFees({
      agentName: provider.name,
      agreement: agreementTerms,
      rentCollected,
      lines,
      tenantRent: monthTenant ? { amount: monthTenant.rentAmount, frequency: monthTenant.rentFrequency } : undefined,
      feeTypes: ["Management Fee", "Letting Fee"],
    });
    // Management-Fee-only, matching the headline tiles above — Letting Fee still has its own
    // sub-row in the expanded-month breakdown (results includes both types), this just keeps the
    // column-header total from silently combining the two into one number.
    const mgmtResults = results.filter((r) => r.type === "Management Fee");
    return {
      key,
      rentCollected,
      results,
      totalActual: mgmtResults.reduce((s, r) => s + r.actual, 0),
      totalExpected: mgmtResults.reduce((s, r) => s + (r.expected ?? 0), 0),
    };
  });
  // Admin/Lease Renewal/Inspection Fee — flat contracted amounts reconciled once for the whole
  // selected span (see the function doc comment above), not accumulated per month.
  const flatFeeResults = reconcileFlatFees({
    agentName: provider.name,
    agreement: agreementTerms,
    lines: collectAgentFeeLines(expensesInRange),
    statementCount,
  });

  const totalRent = monthRows.reduce((s, m) => s + m.rentCollected, 0);
  // Headline tiles are scoped to Management Fee alone — the per-type breakdown below already
  // covers letting/admin/renewal/inspection, and mixing every fee type into one "agent fees"
  // number made it read as the management fee being wildly over/under-charged when it was really
  // a one-off letting or admin fee skewing the total.
  const mgmtRowsOnly = monthRows.map((m) => m.results.filter((r) => r.type === "Management Fee"));
  const totalActual = mgmtRowsOnly.reduce((s, rs) => s + rs.reduce((s2, r) => s2 + r.actual, 0), 0);
  const totalExpected = mgmtRowsOnly.reduce((s, rs) => s + rs.reduce((s2, r) => s2 + (r.expected ?? 0), 0), 0);
  // Management-Fee-only total across every period — the monthly table's own column footer, kept
  // consistent with the Management-Fee-only headline tiles above (Letting Fee is broken out in each
  // month's own expanded row instead, see monthRows above).
  const monthlyTotalActual = monthRows.reduce((s, m) => s + m.totalActual, 0);
  const monthlyTotalExpected = monthRows.reduce((s, m) => s + m.totalExpected, 0);
  const flaggedMonths = monthRows.filter((m) =>
    m.results.some((r) => r.status === "overcharge" || r.status === "not_charged" || r.status === "unspecified"),
  );
  // Management/Letting Fee rolled up from the per-month rows (mathematically identical to
  // computing them once for the span), plus the once-per-span flat-fee results — one flag per fee
  // category for the whole selected span, answers "was the admin fee / inspection fee / etc. right
  // this year" without having to expand every month and add it up by hand.
  const categoryTotals = [...summarizeFeeChecksByType(monthRows.map((m) => m.results)), ...flatFeeResults];

  const toggleMonth = (key: string) =>
    setExpandedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">
          Checks rent collected and every posted agent-fee expense, period by period, against {provider.name}'s
          management agreement.
        </div>
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
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded border p-3">
          <div className="text-xs text-muted-foreground">Rent collected</div>
          <div className="text-lg font-semibold">{fmtCurrency(totalRent)}</div>
        </div>
        <div className="rounded border p-3">
          <div className="text-xs text-muted-foreground">Management fees charged</div>
          <div className="text-lg font-semibold">{fmtCurrency(totalActual)}</div>
        </div>
        <div className="rounded border p-3">
          <div className="text-xs text-muted-foreground">Management fees agreed</div>
          <div className="text-lg font-semibold">{fmtCurrency(totalExpected)}</div>
        </div>
      </div>

      {categoryTotals.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-medium">
            By fee category — {fy === "all" ? "all time" : `FY ${fy}`} total vs. {provider.name}'s agreement
          </div>
          <div className="space-y-1">
            {categoryTotals.map((r) => (
              <FeeCheckRow key={r.type} result={r} />
            ))}
          </div>
        </div>
      )}

      {monthRows.length === 0 ? (
        <div className="rounded border p-3 text-xs text-muted-foreground">
          No rent collected and no agent fees posted for {fy === "all" ? "this property" : `FY ${fy}`}.
        </div>
      ) : (
        <div className="overflow-hidden rounded border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-muted-foreground">
                <th className="px-2 py-1.5 font-medium">Period</th>
                <th className="px-2 py-1.5 text-right font-medium">Rent collected</th>
                <th className="px-2 py-1.5 text-right font-medium">Fees charged</th>
                <th className="px-2 py-1.5 text-right font-medium">Agreed</th>
                <th className="w-8 px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {monthRows.map((m) => {
                const open = expandedMonths.has(m.key);
                const hasFlag = m.results.some(
                  (r) => r.status === "overcharge" || r.status === "not_charged" || r.status === "unspecified",
                );
                return (
                  <Fragment key={m.key}>
                    <tr className="cursor-pointer border-b last:border-0 hover:bg-muted/30" onClick={() => toggleMonth(m.key)}>
                      <td className="px-2 py-1.5 font-medium">
                        {feeVerificationMonthLabel(m.key)}
                        {hasFlag && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />}
                      </td>
                      <td className="px-2 py-1.5 text-right">{fmtCurrency(m.rentCollected)}</td>
                      <td className="px-2 py-1.5 text-right">{fmtCurrency(m.totalActual)}</td>
                      <td className="px-2 py-1.5 text-right text-muted-foreground">{fmtCurrency(m.totalExpected)}</td>
                      <td className="px-2 py-1.5 text-center">{open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}</td>
                    </tr>
                    {open && (
                      <tr className="border-b last:border-0 bg-muted/10">
                        <td colSpan={5} className="space-y-1 px-2 py-2">
                          {m.results.length === 0 ? (
                            <div className="text-muted-foreground">No agent activity this period.</div>
                          ) : (
                            m.results.map((r) => <FeeCheckRow key={r.type} result={r} />)
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t bg-muted/30 font-medium">
                <td className="px-2 py-1.5">{fy === "all" ? "All time" : `FY ${fy}`} total</td>
                <td className="px-2 py-1.5 text-right">{fmtCurrency(totalRent)}</td>
                <td className="px-2 py-1.5 text-right">{fmtCurrency(monthlyTotalActual)}</td>
                <td className="px-2 py-1.5 text-right text-muted-foreground">{fmtCurrency(monthlyTotalExpected)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {flaggedMonths.length > 0 && (
        <div className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
          {flaggedMonths.length} month{flaggedMonths.length === 1 ? "" : "s"} worth a closer look — expand the row(s)
          marked <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500 align-middle" /> above.
        </div>
      )}
    </div>
  );
}

export function PropertyProvidersTab({ propertyId }: { propertyId: string }) {
  const { state } = useStore();
  const taggedProviderIds = new Set(
    state.providerProperties.filter((pp) => pp.propertyId === propertyId).map((pp) => pp.providerId),
  );
  const providers = state.providers.filter((p) => taggedProviderIds.has(p.id));
  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          Council, agent, insurer and trade contacts for this property. Bills processed by email auto-fill these when a
          notice prints vendor details.
        </div>
        <ProviderDialog propertyId={propertyId}>
          <Button size="sm" variant="outline" className="h-7 shrink-0 gap-1 text-xs">
            <Plus className="h-3 w-3" /> Add
          </Button>
        </ProviderDialog>
      </div>
      {providers.length === 0 && <div className="text-xs text-muted-foreground">No contacts yet.</div>}
      <div className="space-y-2">
        {providers.map((p) => (
          <ProviderRow
            key={p.id}
            provider={p}
            propertyId={propertyId}
            agreement={latestAgreementFor(state.providerAgreements, p.id, propertyId)}
            linkToProfile
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Deleting a tenant cascades to their entire ledger, invoices, rent-change history and
 * lease-history — a single-click browser confirm() was too easy to fire by accident given how
 * much data disappears. Requires typing the tenant's exact name before the button unlocks.
 */
export function DeleteTenantDialog({ tenant, trigger }: { tenant: Tenant; trigger?: React.ReactNode }) {
  const { state, deleteTenant } = useStore();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const ledgerCount = state.ledger.filter((e) => e.tenantId === tenant.id).length;
  const invoiceCount = state.invoices.filter((i) => i.tenantId === tenant.id).length;
  const rentChangeCount = state.rentChanges.filter((r) => r.tenantId === tenant.id).length;
  const leaseHistoryCount = state.leaseHistory.filter((h) => h.tenantId === tenant.id).length;

  const canDelete = confirmText.trim() === tenant.name;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setConfirmText("");
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="icon" variant="ghost" title="Delete tenant">
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {tenant.name}?</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
            <div className="font-medium text-destructive">This cannot be undone.</div>
            <div className="mt-1 text-muted-foreground">
              Deletes the tenant record and everything tied to it: {ledgerCount} ledger entr{ledgerCount === 1 ? "y" : "ies"},{" "}
              {invoiceCount} invoice(s), {rentChangeCount} rent-change record(s), {leaseHistoryCount} lease-history record(s).
            </div>
          </div>
          <Field label={`Type "${tenant.name}" to confirm`}>
            <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" />
          </Field>
        </div>
        <DialogFooter>
          <Button
            variant="destructive"
            disabled={!canDelete}
            onClick={() => {
              deleteTenant(tenant.id);
              setOpen(false);
              toast.success("Tenant removed");
            }}
          >
            Delete tenant
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Deleting a property is destructive and irreversible (no FK cascade backs it — every table is
 * cleared by hand in the store), so this offers a choice rather than a single "are you sure":
 * wipe the property entirely, or keep the tenant/rent-received trail (Rental Hub) and purge only
 * the paperwork — bills, transactions, loans, providers, depreciation, inspections, maintenance —
 * so a landlord can start a clean document upload without losing who paid what. */
export function DeletePropertyDialog({ property, trigger, onDeleted }: { property: Property; trigger?: React.ReactNode; onDeleted?: (keptProperty: boolean) => void }) {
  const { state, deleteProperty } = useStore();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"all" | "keepRentalHub">("all");
  const [confirmText, setConfirmText] = useState("");

  const label = (property.alias || property.address).trim();
  const tenantIds = state.tenants.filter((t) => t.propertyId === property.id).map((t) => t.id);
  const tenantCount = tenantIds.length;
  const ledgerCount = state.ledger.filter((e) => tenantIds.includes(e.tenantId)).length;
  const billCount = state.bills.filter((b) => b.propertyId === property.id).length;
  const expenseCount = state.expenses.filter((e) => e.propertyId === property.id).length;
  const loanCount = state.loans.filter((l) => l.propertyId === property.id).length;
  const providerCount = state.providerProperties.filter((pp) => pp.propertyId === property.id).length;
  const inspectionCount = state.inspections.filter((i) => i.propertyId === property.id).length;
  const maintenanceCount = state.maintenanceRequests.filter((m) => m.propertyId === property.id).length;

  const canDelete = confirmText.trim() === label;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setMode("all");
          setConfirmText("");
        }
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="icon" variant="ghost" title="Delete property" className="h-6 w-6 shrink-0">
            <Trash2 className="h-3 w-3" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {label}?</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
            <div className="font-medium text-destructive">This cannot be undone.</div>
            <div className="mt-1 text-muted-foreground">
              This property has {billCount} bill(s), {expenseCount} transaction(s), {loanCount} loan(s),{" "}
              {providerCount} provider(s), {inspectionCount} inspection(s), {maintenanceCount} maintenance request(s),{" "}
              {tenantCount} tenant(s) and {ledgerCount} rent ledger entr{ledgerCount === 1 ? "y" : "ies"}.
            </div>
          </div>

          <RadioGroup value={mode} onValueChange={(v) => setMode(v as typeof mode)} className="gap-2">
            <label className="flex cursor-pointer items-start gap-2 rounded-md border p-3">
              <RadioGroupItem value="all" id="delete-all" className="mt-0.5" />
              <div>
                <div className="font-medium">Delete everything</div>
                <div className="text-xs text-muted-foreground">
                  Removes the property itself and every record tied to it — tenants, rent history, bills,
                  transactions, loans, providers, depreciation, inspections, maintenance. You can then re-add the
                  property fresh.
                </div>
              </div>
            </label>
            <label className="flex cursor-pointer items-start gap-2 rounded-md border p-3">
              <RadioGroupItem value="keepRentalHub" id="delete-keep-rental" className="mt-0.5" />
              <div>
                <div className="font-medium">Keep tenant rent-received history, delete everything else</div>
                <div className="text-xs text-muted-foreground">
                  Keeps the property, its tenants and their rent-received/lease history (Rental Hub) intact. Wipes
                  bills, transactions, loans, providers, depreciation, inspections and maintenance requests — a
                  clean slate for a fresh document upload against the same property.
                </div>
              </div>
            </label>
          </RadioGroup>

          <Field label={`Type "${label}" to confirm`}>
            <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" />
          </Field>
        </div>
        <DialogFooter>
          <Button
            variant="destructive"
            disabled={!canDelete}
            onClick={() => {
              deleteProperty(property.id, { keepRentalHub: mode === "keepRentalHub" });
              setOpen(false);
              toast.success(mode === "keepRentalHub" ? "Property paperwork cleared — rent history kept" : "Property deleted");
              onDeleted?.(mode === "keepRentalHub");
            }}
          >
            {mode === "keepRentalHub" ? "Clear paperwork, keep rent history" : "Delete property"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function computeLeaseEnd(start: string, duration: LeaseDuration | ""): string {
  if (!start || !duration || duration === "Periodic") return "";
  const months = duration === "6 Months" ? 6 : 12;
  const d = new Date(start);
  d.setMonth(d.getMonth() + months);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Shared 12-month rent-increase compliance check (most Australian jurisdictions restrict rent
 * increases — but not decreases — to once every 12 months). Used by both the tenant edit form
 * and the dedicated "Change Rent" action so the rule can't drift between the two entry points.
 */
function checkRentIncreaseCompliance(tenant: Tenant, newRent: number, rentChanges: RentChange[]): boolean {
  if (newRent <= tenant.rentAmount) return true;
  const last = rentChanges
    .filter((r) => r.tenantId === tenant.id)
    .sort((a, b) => (a.changeDate < b.changeDate ? 1 : -1))[0];
  const baseDate = last?.changeDate ?? tenant.lastRentIncreaseDate ?? tenant.leaseStart ?? "";
  if (!baseDate) return true;
  const daysSince = Math.round((Date.now() - new Date(baseDate).getTime()) / 86400000);
  if (daysSince < 365) {
    return confirm(
      "Compliance Notice: Rent increases are legally restricted to once every 12 months in most Australian jurisdictions. Continue anyway?",
    );
  }
  return true;
}

/**
 * A standalone rent change — distinct from lease renewal, since periodic/rolling tenancies get
 * rent changes without a formal renewal in most Australian jurisdictions. Covers increases and
 * decreases; only increases are subject to the 12-month compliance check.
 */
export function IncreaseRentDialog({ tenant, trigger }: { tenant: Tenant; trigger?: React.ReactNode }) {
  const { state, updateTenant } = useStore();
  const [open, setOpen] = useState(false);
  const [newRent, setNewRent] = useState(tenant.rentAmount.toString());
  const [effectiveDate, setEffectiveDate] = useState(todayISO());

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setNewRent(tenant.rentAmount.toString());
          setEffectiveDate(todayISO());
        }
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="icon" variant="ghost" title="Change rent">
            <TrendingUp className="h-4 w-4" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change rent — {tenant.name}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Current rent">
            <Input value={`${fmtCurrency(tenant.rentAmount)}/${tenant.rentFrequency}`} readOnly className="bg-muted" />
          </Field>
          <Field label="New rent (AUD)">
            <Input type="number" value={newRent} onChange={(e) => setNewRent(e.target.value)} />
          </Field>
          <Field label="Effective date">
            <Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button
            onClick={() => {
              const rent = parseFloat(newRent) || 0;
              if (rent === tenant.rentAmount) return toast.error("New rent must be different from the current rent");
              if (rent <= 0) return toast.error("Rent must be greater than zero");
              if (!checkRentIncreaseCompliance(tenant, rent, state.rentChanges)) return;
              updateTenant(tenant.id, { rentAmount: rent, lastRentIncreaseDate: effectiveDate });
              setOpen(false);
              toast.success(
                rent > tenant.rentAmount ? "Rent increased. Previous rent recorded in history." : "Rent decreased. Previous rent recorded in history.",
              );
            }}
          >
            Confirm Change
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RenewLeaseDialog({ tenant, trigger }: { tenant: Tenant; trigger?: React.ReactNode }) {
  const { renewLease } = useStore();
  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [start, setStart] = useState(today);
  const [duration, setDuration] = useState<LeaseDuration | "">((tenant.leaseDuration as LeaseDuration) || "12 Months");
  const [end, setEnd] = useState<string>(computeLeaseEnd(today, "12 Months"));
  const [rent, setRent] = useState(tenant.rentAmount.toString());
  const [frequency, setFrequency] = useState<RentFrequency>(tenant.rentFrequency);
  const [docFileName, setDocFileName] = useState("");
  const [docFileData, setDocFileData] = useState("");

  const onStart = (v: string) => {
    setStart(v);
    if (duration && duration !== "Periodic") setEnd(computeLeaseEnd(v, duration));
  };
  const onDuration = (v: LeaseDuration) => {
    setDuration(v);
    if (v === "Periodic") setEnd("");
    else setEnd(computeLeaseEnd(start, v));
  };
  const onDocFile = (f: File | undefined) => {
    if (!f) return;
    readFileAsDataUrl(f).then((data) => {
      setDocFileName(f.name);
      setDocFileData(data);
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="icon" variant="ghost" title="Renew lease">
            <RefreshCw className="h-4 w-4" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Renew lease — {tenant.name}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="New start date">
            <Input type="date" value={start} onChange={(e) => onStart(e.target.value)} />
          </Field>
          <Field label="Duration">
            <Select value={duration || undefined} onValueChange={(v) => onDuration(v as LeaseDuration)}>
              <SelectTrigger>
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="6 Months">6 Months</SelectItem>
                <SelectItem value="12 Months">12 Months</SelectItem>
                <SelectItem value="Periodic">Periodic / Ongoing</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Calculated end date">
            <Input value={end || "Periodic (no fixed end)"} readOnly className="bg-muted" />
          </Field>
          <Field label="New rent (AUD)">
            <Input type="number" value={rent} onChange={(e) => setRent(e.target.value)} />
          </Field>
          <Field label="Frequency">
            <Select value={frequency} onValueChange={(v) => setFrequency(v as RentFrequency)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Weekly">Weekly</SelectItem>
                <SelectItem value="Fortnightly">Fortnightly</SelectItem>
                <SelectItem value="Monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="New lease document (optional — replaces the current one, original is archived to history)">
              <Input type="file" accept="application/pdf,image/*" onChange={(e) => onDocFile(e.target.files?.[0])} />
              {docFileName && <div className="mt-1 text-xs text-muted-foreground">📎 {docFileName}</div>}
            </Field>
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={() => {
              renewLease(tenant.id, {
                newStart: start,
                newEnd: end || undefined,
                newDuration: (duration as LeaseDuration) || undefined,
                newRent: parseFloat(rent) || 0,
                newFrequency: frequency,
                newLeaseDocumentFileName: docFileName || undefined,
                newLeaseDocumentFileData: docFileData || undefined,
              });
              setOpen(false);
              toast.success("Lease renewed. Previous lease archived to history.");
            }}
          >
            Confirm Renewal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface TenantInitialValues {
  name?: string;
  email?: string;
  phone?: string;
  rentAmount?: number;
  rentFrequency?: RentFrequency;
  leaseStart?: string;
  leaseExpiry?: string;
  leaseDuration?: LeaseDuration;
  bondAmount?: number;
  /** The original lease PDF, carried over so it doesn't have to be re-uploaded after AI extraction. */
  leaseDocumentFileName?: string;
  leaseDocumentFileData?: string;
}

export function TenantDialog({
  propertyId,
  tenant,
  initialValues,
  onSaved,
  children,
}: {
  propertyId: string;
  tenant?: Tenant;
  /** Pre-fills a *new* tenant's form from AI-extracted data (e.g. a reviewed lease proposal). Ignored in edit mode. */
  initialValues?: TenantInitialValues;
  /** Called after the tenant is actually saved (not when the dialog merely opens), with its id. */
  onSaved?: (tenantId: string) => void;
  children?: React.ReactNode;
}) {
  const { addTenant, updateTenant, state } = useStore();
  const [open, setOpen] = useState(false);
  const propertyUnits = state.properties.find((p) => p.id === propertyId)?.units ?? [];
  const buildForm = () => ({
    name: tenant?.name ?? initialValues?.name ?? "",
    email: tenant?.email ?? initialValues?.email ?? "",
    phone: tenant?.phone ?? initialValues?.phone ?? "",
    emergencyContactName: tenant?.emergencyContactName ?? "",
    emergencyContactRelationship: tenant?.emergencyContactRelationship ?? "",
    emergencyContactPhone: tenant?.emergencyContactPhone ?? "",
    permanentAddress: tenant?.permanentAddress ?? "",
    unitAddress: tenant?.unitAddress ?? "",
    unitId: tenant?.unitId ?? "",
    noticePeriod: tenant?.noticePeriod ?? "",
    leaseStart: tenant?.leaseStart ?? initialValues?.leaseStart ?? "",
    leaseExpiry: tenant?.leaseExpiry ?? initialValues?.leaseExpiry ?? "",
    leaseDuration: (tenant?.leaseDuration ?? initialValues?.leaseDuration ?? "") as LeaseDuration | "",
    lastRentIncreaseDate: tenant?.lastRentIncreaseDate ?? "",
    rentAmount: tenant?.rentAmount?.toString() ?? initialValues?.rentAmount?.toString() ?? "",
    rentFrequency: (tenant?.rentFrequency ?? initialValues?.rentFrequency ?? "Weekly") as RentFrequency,
    bankReference: tenant?.bankReference ?? "",
    bankAccountHolder: tenant?.bankAccountHolder ?? "",
    bondAmount: tenant?.bondAmount?.toString() ?? initialValues?.bondAmount?.toString() ?? "",
    bondLodgementDate: tenant?.bondLodgementDate ?? "",
    bondReceiptNumber: tenant?.bondReceiptNumber ?? "",
    leaseDocumentFileName: tenant?.leaseDocumentFileName ?? initialValues?.leaseDocumentFileName ?? "",
    leaseDocumentFileData: tenant?.leaseDocumentFileData ?? initialValues?.leaseDocumentFileData ?? "",
    idProofFileName: tenant?.idProofFileName ?? "",
    idProofFileData: tenant?.idProofFileData ?? "",
    bondTransferFileName: tenant?.bondTransferFileName ?? "",
    bondTransferFileData: tenant?.bondTransferFileData ?? "",
  });
  const [form, setForm] = useState(buildForm);
  const [additionalTenants, setAdditionalTenants] = useState<ContactPerson[]>(tenant?.additionalTenants ?? []);
  const updateAdditionalTenant = (idx: number, patch: Partial<ContactPerson>) =>
    setAdditionalTenants((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const addAdditionalTenant = () => setAdditionalTenants((rows) => [...rows, { name: "" }]);
  const removeAdditionalTenant = (idx: number) => setAdditionalTenants((rows) => rows.filter((_, i) => i !== idx));

  const onStart = (v: string) => {
    setForm((s) => ({
      ...s,
      leaseStart: v,
      leaseExpiry:
        s.leaseDuration && s.leaseDuration !== "Periodic" ? computeLeaseEnd(v, s.leaseDuration) : s.leaseExpiry,
    }));
  };
  const onDuration = (v: LeaseDuration) => {
    setForm((s) => ({
      ...s,
      leaseDuration: v,
      leaseExpiry: v === "Periodic" ? "" : computeLeaseEnd(s.leaseStart, v),
    }));
  };
  const onFile = (key: "leaseDocument" | "idProof" | "bondTransfer", f: File | undefined) => {
    if (!f) return;
    readFileAsDataUrl(f).then((data) =>
      setForm((s) => ({ ...s, [`${key}FileName`]: f.name, [`${key}FileData`]: data } as typeof s)),
    );
  };
  const onLeaseFile = (f: File | undefined) => onFile("leaseDocument", f);

  const check12Months = () => {
    if (!tenant) return true;
    return checkRentIncreaseCompliance(tenant, parseFloat(form.rentAmount), state.rentChanges);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setForm(buildForm());
          setAdditionalTenants(tenant?.additionalTenants ?? []);
        }
      }}
    >
      <DialogTrigger asChild>{children ?? <Button size="sm">Add Tenant</Button>}</DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{tenant ? "Edit tenant" : "Onboard tenant"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Full name *">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Rent amount *">
            <Input
              type="number"
              value={form.rentAmount}
              onChange={(e) => setForm({ ...form, rentAmount: e.target.value })}
            />
          </Field>
          <Field label="Rent frequency *">
            <Select
              value={form.rentFrequency}
              onValueChange={(v) => setForm({ ...form, rentFrequency: v as RentFrequency })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Weekly">Weekly</SelectItem>
                <SelectItem value="Fortnightly">Fortnightly</SelectItem>
                <SelectItem value="Monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Email">
            <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Phone">
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
          {propertyUnits.length > 0 && (
            <Field label="Dwelling">
              <Select
                value={form.unitId}
                onValueChange={(v) => {
                  const unit = propertyUnits.find((u) => u.id === v);
                  setForm((f) => ({ ...f, unitId: v, unitAddress: unit?.address || f.unitAddress }));
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Which dwelling is this tenancy in?" />
                </SelectTrigger>
                <SelectContent>
                  {propertyUnits.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <div className="col-span-2">
            <Field label="Unit / dwelling address (optional)">
              <Input
                value={form.unitAddress}
                onChange={(e) => setForm({ ...form, unitAddress: e.target.value })}
                placeholder="Only needed if this tenant's own address differs from the property's — e.g. a granny flat sharing one title"
              />
            </Field>
          </div>
          <Field label="Lease start date">
            <Input type="date" value={form.leaseStart} onChange={(e) => onStart(e.target.value)} />
          </Field>
          <Field label="Lease duration">
            <Select value={form.leaseDuration || undefined} onValueChange={(v) => onDuration(v as LeaseDuration)}>
              <SelectTrigger>
                <SelectValue placeholder="Periodic / Ongoing" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="6 Months">6 Months</SelectItem>
                <SelectItem value="12 Months">12 Months</SelectItem>
                <SelectItem value="Periodic">Periodic / Ongoing</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Lease end date (auto)">
            <Input
              type="date"
              value={form.leaseExpiry}
              onChange={(e) => setForm({ ...form, leaseExpiry: e.target.value })}
              placeholder="Periodic"
            />
          </Field>
          <Field label="Last rent increase date">
            <Input
              type="date"
              value={form.lastRentIncreaseDate}
              onChange={(e) => setForm({ ...form, lastRentIncreaseDate: e.target.value })}
            />
          </Field>
          <Field label="Bank reference code">
            <Input value={form.bankReference} onChange={(e) => setForm({ ...form, bankReference: e.target.value })} />
          </Field>
          <Field label="Bank account holder">
            <Input
              value={form.bankAccountHolder}
              onChange={(e) => setForm({ ...form, bankAccountHolder: e.target.value })}
            />
          </Field>
          <Field label="Bond amount">
            <Input
              type="number"
              value={form.bondAmount}
              onChange={(e) => setForm({ ...form, bondAmount: e.target.value })}
            />
          </Field>
          <Field label="Bond lodgement date">
            <Input
              type="date"
              value={form.bondLodgementDate}
              onChange={(e) => setForm({ ...form, bondLodgementDate: e.target.value })}
            />
          </Field>
          <Field label="Bond receipt #">
            <Input
              value={form.bondReceiptNumber}
              onChange={(e) => setForm({ ...form, bondReceiptNumber: e.target.value })}
            />
          </Field>
          <Field label="Emergency contact name">
            <Input value={form.emergencyContactName} onChange={(e) => setForm({ ...form, emergencyContactName: e.target.value })} />
          </Field>
          <Field label="Emergency contact relationship">
            <Input value={form.emergencyContactRelationship} onChange={(e) => setForm({ ...form, emergencyContactRelationship: e.target.value })} />
          </Field>
          <Field label="Emergency contact phone">
            <Input value={form.emergencyContactPhone} onChange={(e) => setForm({ ...form, emergencyContactPhone: e.target.value })} />
          </Field>
          <Field label="Notice period">
            <Input value={form.noticePeriod} onChange={(e) => setForm({ ...form, noticePeriod: e.target.value })} placeholder="e.g. 14 days" />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Permanent / previous address">
              <Input value={form.permanentAddress} onChange={(e) => setForm({ ...form, permanentAddress: e.target.value })} />
            </Field>
          </div>
          <div className="space-y-2 rounded-md border p-3 sm:col-span-2">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium">Additional / co-tenants</div>
              <Button type="button" size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={addAdditionalTenant}>
                <Plus className="h-3 w-3" /> Add
              </Button>
            </div>
            {additionalTenants.map((t, idx) => (
              <div key={idx} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
                <Field label="Name">
                  <Input value={t.name} onChange={(e) => updateAdditionalTenant(idx, { name: e.target.value })} />
                </Field>
                <Field label="Email">
                  <Input
                    type="email"
                    value={t.email ?? ""}
                    onChange={(e) => updateAdditionalTenant(idx, { email: e.target.value })}
                  />
                </Field>
                <Field label="Phone">
                  <Input
                    inputMode="tel"
                    value={t.phone ?? ""}
                    onChange={(e) => updateAdditionalTenant(idx, { phone: e.target.value })}
                  />
                </Field>
                <Button size="icon" variant="ghost" onClick={() => removeAdditionalTenant(idx)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
          <Field label="Lease agreement (PDF)">
            <Input type="file" accept="application/pdf,image/*" onChange={(e) => onLeaseFile(e.target.files?.[0])} />
            {form.leaseDocumentFileName && (
              <div className="mt-1 text-xs text-muted-foreground">📎 {form.leaseDocumentFileName}</div>
            )}
          </Field>
          <Field label="ID proof">
            <Input type="file" accept="application/pdf,image/*" onChange={(e) => onFile("idProof", e.target.files?.[0])} />
            {form.idProofFileName && <div className="mt-1 text-xs text-muted-foreground">📎 {form.idProofFileName}</div>}
          </Field>
          <Field label="Bond transfer receipt">
            <Input type="file" accept="application/pdf,image/*" onChange={(e) => onFile("bondTransfer", e.target.files?.[0])} />
            {form.bondTransferFileName && <div className="mt-1 text-xs text-muted-foreground">📎 {form.bondTransferFileName}</div>}
          </Field>
        </div>
        <DialogFooter>
          <Button
            onClick={() => {
              if (!form.name) return toast.error("Name is required");
              if (!form.rentAmount) return toast.error("Rent amount is required");
              if (!check12Months()) return;
              const rentAmount = parseFloat(form.rentAmount) || 0;
              const defaultPaid = form.leaseStart
                ? new Date(new Date(form.leaseStart).getTime() - 86400000).toISOString().slice(0, 10)
                : todayISO();
              const payload: Omit<Tenant, "id" | "paidUpToDate"> & { paidUpToDate?: string } = {
                name: form.name,
                email: form.email || undefined,
                phone: form.phone || undefined,
                emergencyContactName: form.emergencyContactName || undefined,
                emergencyContactRelationship: form.emergencyContactRelationship || undefined,
                emergencyContactPhone: form.emergencyContactPhone || undefined,
                permanentAddress: form.permanentAddress || undefined,
                unitAddress: form.unitAddress || undefined,
                unitId: form.unitId || undefined,
                noticePeriod: form.noticePeriod || undefined,
                propertyId,
                leaseStart: form.leaseStart || undefined,
                leaseExpiry: form.leaseExpiry || undefined,
                leaseDuration: (form.leaseDuration || undefined) as LeaseDuration | undefined,
                lastRentIncreaseDate: form.lastRentIncreaseDate || undefined,
                rentAmount,
                rentFrequency: form.rentFrequency,
                bankReference: form.bankReference || undefined,
                bankAccountHolder: form.bankAccountHolder || undefined,
                bondAmount: form.bondAmount ? parseFloat(form.bondAmount) : undefined,
                bondLodgementDate: form.bondLodgementDate || undefined,
                bondReceiptNumber: form.bondReceiptNumber || undefined,
                leaseDocumentFileName: form.leaseDocumentFileName || undefined,
                leaseDocumentFileData: form.leaseDocumentFileData || undefined,
                idProofFileName: form.idProofFileName || undefined,
                idProofFileData: form.idProofFileData || undefined,
                bondTransferFileName: form.bondTransferFileName || undefined,
                bondTransferFileData: form.bondTransferFileData || undefined,
                additionalTenants: additionalTenants.filter((t) => t.name.trim()).length
                  ? additionalTenants.filter((t) => t.name.trim())
                  : undefined,
                paidUpToDate: tenant?.paidUpToDate ?? defaultPaid,
              };
              let savedId: string;
              if (tenant) {
                updateTenant(tenant.id, payload);
                savedId = tenant.id;
              } else {
                savedId = addTenant(payload);
              }
              setOpen(false);
              onSaved?.(savedId);
              toast.success("Tenant saved");
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
