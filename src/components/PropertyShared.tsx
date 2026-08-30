import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useStore } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
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
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { fmtCurrency, todayISO, ausFinancialYear, fyRange, daysUntil, buildDepreciationSchedule, billTypeToChargeType } from "@/lib/calculations";
import { suggestEffectiveLife } from "@/lib/atoEffectiveLife";
import { findMatchingUnpaidBill, findDuplicateLedgerEntry } from "@/lib/billMatch";
import { verifyAgentFees, hasFeeTerms, collectAgentFeeLines, type FeeCheckResult } from "@/lib/feeVerification";
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
  ProviderRole,
  FeeFrequency,
  DepreciationItem,
  DepreciationReportProposalPayload,
  UnclassifiedProposalPayload,
  LoanDocumentProposalPayload,
  LoanStatementProposalPayload,
  BankStatementProposalPayload,
  PropertySaleProposalPayload,
  AgencyAgreementProposalPayload,
  Loan,
  Expense,
  PropertyUnit,
  Entity,
} from "@/lib/types";
import { toast } from "sonner";
import { BillsBoard } from "@/components/BillsBoard";
import { UploadDocumentDialog } from "@/components/UploadDocumentDialog";
import { AddBillDialog } from "@/components/AddBillDialog";
import { AddTransactionDialog } from "@/components/AddTransactionDialog";
import { AddDepreciationReportDialog } from "@/components/AddDepreciationReportDialog";
import { DocumentReviewCard } from "@/components/DocumentReviewCard";
import { Checkbox } from "@/components/ui/checkbox";
import { fillLeaseTemplate, toDDMMYYYY, appendPdf, SMOKE_ALARM_BATTERY_TYPES } from "@/lib/leaseTemplate";
import { downloadBlob, downloadPdfAndEmailViaGmail } from "@/lib/emailPdf";
import { supabase } from "@/integrations/supabase/client";
import { openBillDocument, MAX_AI_UPLOAD_BYTES, formatFileSize } from "@/lib/files";
import { DocumentLink } from "@/components/DocumentLink";
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
        <ProposalCard
          proposal={proposal}
          onDismiss={() => {
            dismissProposal(proposal.id);
            onOpenChange(false);
          }}
        />
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
            onSaved={() => markProposalApplied(proposal.id)}
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
        taxCategory: "Capital Works",
        hasWarranty: false,
        rechargeToTenant: false,
        status: "approved",
        source: "upload",
        notes: "Settlement adjustment from a PEXA record / Statement of Adjustments.",
        invoiceFileName: proposal.sourceFileName,
        invoiceFileData: proposal.sourceFileData,
      });
    }
    markProposalApplied(proposal.id);
    toast.success(ownerChecked && ownerName.trim() ? "Property details updated — entity linked" : "Property details updated");
  };

  return (
    <DocumentReviewCard proposal={proposal}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{payload.documentCategory}</Badge>
          {proposal.rawPropertyAddress && <span className="text-xs text-muted-foreground">{proposal.rawPropertyAddress}</span>}
        </div>

        {!proposal.propertyId && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-destructive">No property matched — assign one:</span>
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

function RentLedgerProposalCard({ proposal, onDismiss }: { proposal: AiIntakeProposal; onDismiss: () => void }) {
  const { state, addLedger, addExpense, markBillPaid, markProposalApplied } = useStore();
  const payload = proposal.payload as RentLedgerProposalPayload;
  const [propertyId, setPropertyId] = useState(proposal.propertyId ?? "");
  const expenseLines = payload.expenseLines ?? [];

  const tenantsAtProperty = propertyId ? state.tenants.filter((t) => t.propertyId === propertyId) : state.tenants;
  // A changeover statement (outgoing + incoming tenant in the same period) needs each line
  // attributed individually rather than one tenant picked for the whole statement — but that's
  // only ever ambiguous when the property actually has more than one tenant on file.
  const multiTenant = tenantsAtProperty.length > 1;
  const tenantNameMatched =
    !payload.tenantName || tenantsAtProperty.some((t) => t.name.trim().toLowerCase() === payload.tenantName!.trim().toLowerCase());

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
  const ledgerDuplicates = payload.transactions.map((tx, i) =>
    txTenantIds[i] ? findDuplicateLedgerEntry(state.ledger, { tenantId: txTenantIds[i], amount: tx.amount, date: tx.date }) : null,
  );
  const [expensesIncluded, setExpensesIncluded] = useState<boolean[]>(() => expenseLines.map(() => true));
  // Deductions default to the one tenant every included payment is already going to (the common
  // single-tenant case) — left "shared" whenever more than one tenant is actually involved, since
  // which tenant (if any) a given fee line relates to isn't something to guess at.
  const soleTxTenant = (() => {
    const ids = new Set(payload.transactions.map((tx) => defaultTenantFor(tx.tenantName)).filter(Boolean));
    return ids.size === 1 ? [...ids][0] : SHARED_EXPENSE_TENANT;
  })();
  const [expTenantIds, setExpTenantIds] = useState<string[]>(() => expenseLines.map(() => soleTxTenant));
  // An agent statement's deduction is often just reporting that a bill already sitting in
  // Bills/Unpaid was paid on the owner's behalf — suggest marking THAT bill paid instead of
  // creating a second, disconnected Expense for the same real-world payment.
  const billMatches = expenseLines.map((e) =>
    findMatchingUnpaidBill(state.bills, { propertyId, vendorOrDescription: e.vendor, amount: e.amount, date: e.date }),
  );
  const [matchAsBill, setMatchAsBill] = useState<boolean[]>(() => billMatches.map((m) => !!m));

  const includedIncome = payload.transactions.reduce((s, tx, i) => (included[i] ? s + tx.amount : s), 0);
  const includedExpenses = expenseLines.reduce((s, e, i) => (expensesIncluded[i] ? s + e.amount : s), 0);
  const computedNet = includedIncome - includedExpenses;
  // A statement can show a running balance the agent holds between periods — when it does, the
  // amount actually paid to the owner is this period's activity adjusted by that rollover, not
  // period income/expenses alone (see LEDGER_PROMPT in parse-ledger.ts).
  const hasBalanceRollover = payload.openingBalance !== undefined || payload.closingBalance !== undefined;
  const reconciledNet = computedNet + (payload.openingBalance ?? 0) - (payload.closingBalance ?? 0);

  const agent = state.providers.find((p) => p.propertyId === propertyId && p.role === "Agent");
  const assignedIncludedTenantIds = [...new Set(payload.transactions.filter((_, i) => included[i]).map((_, i) => txTenantIds[i]).filter(Boolean))];
  const singleAssignedTenant =
    assignedIncludedTenantIds.length === 1 ? state.tenants.find((t) => t.id === assignedIncludedTenantIds[0]) : undefined;
  const feeChecks: FeeCheckResult[] =
    agent && hasFeeTerms(agent)
      ? verifyAgentFees({
          provider: agent,
          rentCollected: includedIncome,
          lines: expenseLines.filter((_, i) => expensesIncluded[i]),
          tenantRent: singleAssignedTenant ? { amount: singleAssignedTenant.rentAmount, frequency: singleAssignedTenant.rentFrequency } : undefined,
        })
      : [];

  const confirm = () => {
    if (payload.transactions.some((_, i) => included[i] && !txTenantIds[i])) {
      return toast.error("Assign a tenant to every included payment first");
    }
    payload.transactions.forEach((tx, i) => {
      if (!included[i]) return;
      addLedger({
        tenantId: txTenantIds[i],
        date: tx.date,
        type: "Rent Payment",
        description: tx.description,
        debit: 0,
        credit: tx.amount,
        source: "rent_statement",
        sourceFileName: proposal.sourceFileName,
        sourceFileData: proposal.sourceFileData,
      });
    });
    expenseLines.forEach((e, i) => {
      if (!expensesIncluded[i]) return;
      const match = billMatches[i];
      if (match && matchAsBill[i]) {
        markBillPaid(match.id, { paidDate: e.date });
        return;
      }
      const lineTenantId = expTenantIds[i];
      addExpense({
        itemName: e.vendor,
        cost: e.amount,
        date: e.date,
        propertyId: propertyId || undefined,
        taxCategory: "Immediate Deduction",
        category: "Property Agent Fees",
        // The AI's raw free-text classification (e.g. "management_fees") — itemName alone is
        // usually just the agency's name, so this is the only signal fee verification has to work
        // with once this line becomes a plain Expense row (see classifyFeeLine in feeVerification.ts).
        notes: e.category || undefined,
        hasWarranty: false,
        rechargeToTenant: false,
        tenantId: lineTenantId && lineTenantId !== SHARED_EXPENSE_TENANT ? lineTenantId : undefined,
        status: "approved",
        source: "email_auto",
        rawPropertyAddress: proposal.rawPropertyAddress,
        sourceSubject: proposal.sourceSubject,
        sourceEmailBody: proposal.sourceEmailBody,
        invoiceFileName: proposal.sourceFileName,
        invoiceFileData: proposal.sourceFileData,
      });
    });
    markProposalApplied(proposal.id);
    toast.success(
      expenseLines.some((_, i) => expensesIncluded[i]) ? "Rent payments and expenses added" : "Rent payments added",
    );
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

        {!propertyId && (
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
        )}

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
            {!txTenantIds[0] && payload.tenantName && !tenantNameMatched && (
              <>
                <span className="text-xs text-destructive">No tenant found matching "{payload.tenantName}"</span>
                <TenantDialog
                  propertyId={propertyId}
                  initialValues={{ name: payload.tenantName }}
                  onSaved={(id) => {
                    setTxTenantIds((ids) => ids.map(() => id));
                    setExpTenantIds((ids) => ids.map(() => id));
                  }}
                >
                  <Button size="sm" variant="outline" disabled={!propertyId}>
                    Add as new tenant
                  </Button>
                </TenantDialog>
              </>
            )}
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
          {payload.transactions.map((tx, i) => (
            <div key={i} className="space-y-1 border-b pb-1 last:border-b-0 last:pb-0">
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={included[i]}
                  onChange={(e) => setIncluded((inc) => inc.map((v, j) => (j === i ? e.target.checked : v)))}
                />
                <span className="w-24 shrink-0">{tx.date}</span>
                <span className="w-20 shrink-0 font-medium">{fmtCurrency(tx.amount)}</span>
                <span className="flex-1 truncate text-muted-foreground">{tx.description}</span>
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
              </label>
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
        </div>

        {expenseLines.length > 0 && (
          <div className="space-y-1 rounded border p-2">
            <div className="text-[11px] font-medium text-muted-foreground">
              Deductions on this statement → expenses
            </div>
            {expenseLines.map((e, i) => (
              <div key={i} className="space-y-1 border-b pb-1 last:border-b-0 last:pb-0">
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={expensesIncluded[i]}
                    onChange={(ev) => setExpensesIncluded((inc) => inc.map((v, j) => (j === i ? ev.target.checked : v)))}
                  />
                  <span className="w-24 shrink-0">{e.date}</span>
                  <span className="w-20 shrink-0 font-medium">{fmtCurrency(e.amount)}</span>
                  <span className="w-28 shrink-0 truncate">{e.vendor}</span>
                  <span className="flex-1 truncate text-muted-foreground">{e.description}</span>
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
                </label>
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
              </div>
            ))}
          </div>
        )}

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

        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" onClick={confirm}>
            Confirm &amp; Add Payments
          </Button>
          <Button size="sm" variant="outline" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
    </DocumentReviewCard>
  );
}

/** Shared row renderer for one FeeCheckResult — used both inline during rent-statement review
 * and in the standalone verification report/EOFY summary, so the colour/wording never drifts. */
export function FeeCheckRow({ result }: { result: FeeCheckResult }) {
  const { type, expected, actual, variance, status } = result;
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
    <div className={`flex flex-wrap items-center justify-between gap-2 rounded border px-2 py-1 text-xs ${style}`}>
      <span className="font-medium">{type}</span>
      <span>{message}</span>
    </div>
  );
}

function DepreciationReportProposalCard({ proposal, onDismiss }: { proposal: AiIntakeProposal; onDismiss: () => void }) {
  const { state, addDepreciationItem, markProposalApplied } = useStore();
  const payload = proposal.payload as DepreciationReportProposalPayload;
  const [propertyId, setPropertyId] = useState(proposal.propertyId ?? "");
  const [included, setIncluded] = useState<boolean[]>(() => payload.items.map(() => true));

  const confirm = () => {
    const assetId = state.properties.find((p) => p.id === propertyId)?.assetId;
    if (!assetId) return toast.error("Select a property first");
    const reportId = uid("dr");
    let count = 0;
    payload.items.forEach((it, i) => {
      if (!included[i]) return;
      addDepreciationItem({
        assetId,
        description: it.description,
        purchaseCost: it.cost,
        effectiveLifeYears: it.lifeYears || 1,
        purchaseDate: payload.effectiveFrom || undefined,
        method: "Diminishing Value",
        division: it.division,
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
    markProposalApplied(proposal.id);
    toast.success(`Added ${count} depreciation item(s) from report`);
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
            Add selected items
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
      interestRate: payload.interestRate ?? 0,
      monthlyEmi: payload.monthlyRepayment ?? 0,
      status: "Active",
    });
    markProposalApplied(proposal.id);
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
  const { state, updateLoan, addExpense, markProposalApplied } = useStore();
  const payload = proposal.payload as LoanStatementProposalPayload;
  const [propertyId, setPropertyId] = useState(proposal.propertyId ?? "");
  const [loanId, setLoanId] = useState(proposal.matchedLoanId ?? "");
  const [logInterest, setLogInterest] = useState(!!payload.interestCharged);

  const loansForProperty = propertyId ? state.loans.filter((l) => l.propertyId === propertyId) : [];

  const confirm = () => {
    if (!loanId) return toast.error("Select which loan this statement is for");
    const patch: Record<string, unknown> = {};
    if (payload.closingBalance !== undefined) patch.totalBalance = payload.closingBalance;
    if (Object.keys(patch).length > 0) updateLoan(loanId, patch as Partial<Loan>);
    if (logInterest && payload.interestCharged) {
      const loan = state.loans.find((l) => l.id === loanId);
      addExpense({
        itemName: `${payload.lenderName} — loan interest`,
        cost: payload.interestCharged,
        date: payload.periodEnd || todayISO(),
        propertyId,
        assetId: loan?.assetId,
        taxCategory: "Immediate Deduction",
        hasWarranty: false,
        rechargeToTenant: false,
        status: "approved",
        source: "upload",
        periodStart: payload.periodStart || undefined,
        periodEnd: payload.periodEnd || undefined,
        invoiceFileName: proposal.sourceFileName,
        invoiceFileData: proposal.sourceFileData,
      });
    }
    markProposalApplied(proposal.id);
    toast.success("Loan statement applied");
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

        {propertyId && (
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
          </div>
        )}

        <div className="grid grid-cols-2 gap-1 rounded border p-2 text-xs sm:grid-cols-3">
          <div>
            <div className="text-muted-foreground">Interest charged</div>
            <div className="font-medium">{payload.interestCharged ? fmtCurrency(payload.interestCharged) : "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Repayments made</div>
            <div className="font-medium">{payload.repaymentsMade ? fmtCurrency(payload.repaymentsMade) : "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Closing balance</div>
            <div className="font-medium">{payload.closingBalance ? fmtCurrency(payload.closingBalance) : "—"}</div>
          </div>
        </div>

        {!!payload.interestCharged && (
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={logInterest} onChange={(e) => setLogInterest(e.target.checked)} />
            <span>Log {fmtCurrency(payload.interestCharged)} interest charged as a deductible expense</span>
          </label>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" disabled={!loanId} onClick={confirm}>
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
  const { state, addExpense, markBillPaid, markProposalApplied } = useStore();
  const payload = proposal.payload as BankStatementProposalPayload;
  const [propertyId, setPropertyId] = useState(proposal.propertyId ?? "");
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
        taxCategory: "Immediate Deduction",
        hasWarranty: false,
        rechargeToTenant: false,
        status: "approved",
        source: "upload",
        invoiceFileName: proposal.sourceFileName,
        invoiceFileData: proposal.sourceFileData,
      });
      count++;
    });
    if (count === 0) return toast.error("Select at least one transaction to import");
    markProposalApplied(proposal.id);
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
    markProposalApplied(proposal.id);
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
 * Provider's own "Upload & extract" — applies the same extracted fee terms onto that property's
 * Agent Provider record (updating one if it already exists, filling in blanks only, otherwise
 * creating one from the agency name) so both entry points land in the same place. */
function AgencyAgreementProposalCard({ proposal, onDismiss }: { proposal: AiIntakeProposal; onDismiss: () => void }) {
  const { state, addProvider, updateProvider, markProposalApplied } = useStore();
  const payload = proposal.payload as AgencyAgreementProposalPayload;
  const [propertyId, setPropertyId] = useState(proposal.propertyId ?? "");

  const confirm = () => {
    const property = state.properties.find((p) => p.id === propertyId);
    if (!property) return toast.error("Select a property first");

    const existingAgent = state.providers.find((p) => p.propertyId === propertyId && p.role === "Agent");
    const fields = {
      managementFeePercent: payload.managementFeePercent,
      lettingFeeAmount: payload.lettingFeeAmount,
      lettingFeeWeeksRent: payload.lettingFeeWeeksRent,
      adminFeeAmount: payload.adminFeeAmount,
      adminFeeFrequency: payload.adminFeeFrequency,
      leaseRenewalFeeAmount: payload.leaseRenewalFeeAmount,
      inspectionFeeAmount: payload.inspectionFeeAmount,
      advertisingFeeAmount: payload.advertisingFeeAmount,
      noticePeriodDays: payload.noticePeriodDays,
      contractStartDate: payload.contractStartDate,
      contractReviewDate: payload.contractReviewDate,
      contractFileName: proposal.sourceFileName,
      contractFileData: proposal.sourceFileData,
    };
    if (existingAgent) {
      // Never overwrites a value already on file — same "fill blanks only" rule the manual
      // extract-and-review form follows.
      const patch: Partial<Provider> = {};
      for (const [key, value] of Object.entries(fields) as [keyof typeof fields, unknown][]) {
        if (value !== undefined && (existingAgent as unknown as Record<string, unknown>)[key] === undefined) {
          (patch as Record<string, unknown>)[key] = value;
        }
      }
      updateProvider(existingAgent.id, patch);
    } else {
      addProvider({ propertyId, name: payload.agencyName || "Managing agent", role: "Agent", ...fields });
    }
    markProposalApplied(proposal.id);
    toast.success(existingAgent ? "Management agreement applied to existing agent" : "Managing agent added");
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

        <div className="grid grid-cols-2 gap-1 rounded border p-2 text-xs sm:grid-cols-3">
          <div>
            <div className="text-muted-foreground">Management fee</div>
            <div className="font-medium">{payload.managementFeePercent !== undefined ? `${payload.managementFeePercent}%` : "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Letting fee</div>
            <div className="font-medium">
              {payload.lettingFeeAmount !== undefined
                ? fmtCurrency(payload.lettingFeeAmount)
                : payload.lettingFeeWeeksRent !== undefined
                  ? `${payload.lettingFeeWeeksRent} wk rent`
                  : "—"}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Admin fee</div>
            <div className="font-medium">{payload.adminFeeAmount !== undefined ? fmtCurrency(payload.adminFeeAmount) : "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Advertising fee</div>
            <div className="font-medium">{payload.advertisingFeeAmount !== undefined ? fmtCurrency(payload.advertisingFeeAmount) : "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Notice period</div>
            <div className="font-medium">{payload.noticePeriodDays !== undefined ? `${payload.noticePeriodDays} days` : "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Start date</div>
            <div className="font-medium">{payload.contractStartDate || "—"}</div>
          </div>
        </div>

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
  const [form, setForm] = useState({
    address: property?.address ?? initialAddress ?? "",
    alias: property?.alias ?? "",
    tenantCode: property?.tenantCode ?? "",
    managerName: property?.managerName ?? "",
    managerPhone: property?.managerPhone ?? "",
    managerEmail: property?.managerEmail ?? "",
    councilRateRef: property?.councilRateRef ?? "",
    waterAccountRef: property?.waterAccountRef ?? "",
    purchasePrice: property?.purchasePrice?.toString() ?? "",
    currentValue: property?.currentValue?.toString() ?? "",
    purchaseDate: property?.purchaseDate ?? "",
    stampDuty: property?.stampDuty?.toString() ?? "",
    deposit: property?.deposit?.toString() ?? "",
    lotSize: property?.lotSize ?? "",
    physicalAttributes: property?.physicalAttributes ?? "",
    lender: property?.lender ?? "",
    loanAccountRef: property?.loanAccountRef ?? "",
    loanBalance: property?.loanBalance?.toString() ?? "",
    interestRate: property?.interestRate?.toString() ?? "",
    repaymentFrequency: (property?.repaymentFrequency ?? "Monthly") as RepaymentFrequency,
    councilRatesAnnual: property?.councilRatesAnnual?.toString() ?? "",
    waterRatesAnnual: property?.waterRatesAnnual?.toString() ?? "",
    insuranceAnnual: property?.insuranceAnnual?.toString() ?? "",
    strataFeesAnnual: property?.strataFeesAnnual?.toString() ?? "",
    landTaxAnnual: property?.landTaxAnnual?.toString() ?? "",
    repairsMaintenanceAnnual: property?.repairsMaintenanceAnnual?.toString() ?? "",
    pmFeePercent: property?.pmFeePercent?.toString() ?? "",
    inspectionFrequencyMonths: property?.inspectionFrequencyMonths?.toString() ?? "",
    entityId: property?.entityId ?? "",
    occupancyType: (property?.occupancyType ?? "") as Property["occupancyType"] | "",
    strataLevyAmount: property?.strataLevyAmount?.toString() ?? "",
    strataLevyFrequency: property?.strataLevyFrequency ?? "",
    insurerName: property?.insurerName ?? "",
    insurancePolicyNumber: property?.insurancePolicyNumber ?? "",
    insurancePremium: property?.insurancePremium?.toString() ?? "",
    insuranceSumInsured: property?.insuranceSumInsured?.toString() ?? "",
    insuranceRenewalDate: property?.insuranceRenewalDate ?? "",
    smokeAlarmCheckDueDate: property?.smokeAlarmCheckDueDate ?? "",
    poolSafetyCertExpiry: property?.poolSafetyCertExpiry ?? "",
    notes: property?.notes ?? "",
    bedrooms: property?.bedrooms?.toString() ?? "",
    bathrooms: property?.bathrooms?.toString() ?? "",
    carSpaces: property?.carSpaces?.toString() ?? "",
    landSizeSqm: property?.landSizeSqm?.toString() ?? "",
    domainPropertyType: property?.domainPropertyType ?? "",
    dwellingConfiguration: (property?.dwellingConfiguration ?? "House") as Property["dwellingConfiguration"],
  });
  const [photos, setPhotos] = useState<{ name: string; data: string }[]>(property?.photos ?? []);
  const [videos, setVideos] = useState<{ name: string; data: string }[]>(property?.videos ?? []);
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
  // Open the advanced section by default for properties that already have acquisition/loan
  // data on file, so editing doesn't silently hide fields the landlord already filled in.
  const [advancedOpen, setAdvancedOpen] = useState(
    !!property &&
      !!(
        property.purchasePrice ||
        property.currentValue ||
        property.stampDuty ||
        property.deposit ||
        property.lotSize ||
        property.physicalAttributes ||
        property.lender ||
        property.loanAccountRef ||
        property.loanBalance ||
        property.interestRate ||
        property.councilRatesAnnual ||
        property.waterRatesAnnual ||
        property.insuranceAnnual ||
        property.strataFeesAnnual ||
        property.landTaxAnnual ||
        property.repairsMaintenanceAnnual ||
        property.pmFeePercent ||
        property.notes ||
        (property.photos && property.photos.length > 0) ||
        (property.videos && property.videos.length > 0)
      ),
  );

  const currentTenant = property ? state.tenants.find((t) => t.propertyId === property.id) : undefined;

  const onPhotos = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach((f) => {
      const reader = new FileReader();
      reader.onload = () => setPhotos((ps) => [...ps, { name: f.name, data: String(reader.result) }]);
      reader.readAsDataURL(f);
    });
  };
  const onVideos = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach((f) => {
      const reader = new FileReader();
      reader.onload = () => setVideos((vs) => [...vs, { name: f.name, data: String(reader.result) }]);
      reader.readAsDataURL(f);
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) onDone();
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

          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger asChild>
              <Button type="button" variant="outline" size="sm" className="w-full justify-between">
                Portfolio &amp; Acquisition Details
                {advancedOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3 space-y-3">
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
                <div className="sm:col-span-2">
                  <Field label="Property type (Domain)">
                    <Input value={form.domainPropertyType} onChange={(e) => setForm({ ...form, domainPropertyType: e.target.value })} placeholder="e.g. House, Townhouse, Unit" />
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

              <div className="rounded-md border p-3">
                <div className="mb-2 text-sm font-medium">Strata, insurance &amp; compliance</div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Strata levy amount">
                    <Input type="number" value={form.strataLevyAmount} onChange={(e) => setForm({ ...form, strataLevyAmount: e.target.value })} />
                  </Field>
                  <Field label="Strata levy frequency">
                    <Select
                      value={form.strataLevyFrequency || "__unset__"}
                      onValueChange={(v) => setForm({ ...form, strataLevyFrequency: v === "__unset__" ? "" : v })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__unset__">Not set</SelectItem>
                        <SelectItem value="Quarterly">Quarterly</SelectItem>
                        <SelectItem value="Annually">Annually</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Insurer">
                    <Input value={form.insurerName} onChange={(e) => setForm({ ...form, insurerName: e.target.value })} />
                  </Field>
                  <Field label="Policy number">
                    <Input value={form.insurancePolicyNumber} onChange={(e) => setForm({ ...form, insurancePolicyNumber: e.target.value })} />
                  </Field>
                  <Field label="Premium (annual)">
                    <Input type="number" value={form.insurancePremium} onChange={(e) => setForm({ ...form, insurancePremium: e.target.value })} />
                  </Field>
                  <Field label="Sum insured">
                    <Input type="number" value={form.insuranceSumInsured} onChange={(e) => setForm({ ...form, insuranceSumInsured: e.target.value })} />
                  </Field>
                  <Field label="Insurance renewal date">
                    <Input type="date" value={form.insuranceRenewalDate} onChange={(e) => setForm({ ...form, insuranceRenewalDate: e.target.value })} />
                  </Field>
                  <Field label="Smoke alarm check due">
                    <Input type="date" value={form.smokeAlarmCheckDueDate} onChange={(e) => setForm({ ...form, smokeAlarmCheckDueDate: e.target.value })} />
                  </Field>
                  {property?.hasSwimmingPool && (
                    <Field label="Pool safety cert expiry">
                      <Input type="date" value={form.poolSafetyCertExpiry} onChange={(e) => setForm({ ...form, poolSafetyCertExpiry: e.target.value })} />
                    </Field>
                  )}
                </div>
              </div>

              <Field label="Notes">
                <Textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="Anything worth remembering about this property…"
                />
              </Field>

              <div className="rounded-md border p-3">
                <div className="mb-2 text-sm font-medium">Photos &amp; videos</div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Photos">
                    <Input type="file" accept="image/*" multiple onChange={(e) => onPhotos(e.target.files)} />
                  </Field>
                  <Field label="Videos">
                    <Input type="file" accept="video/*" multiple onChange={(e) => onVideos(e.target.files)} />
                  </Field>
                </div>
                {photos.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {photos.map((p, i) => (
                      <div key={i} className="relative">
                        <img src={p.data} alt={p.name} className="h-14 w-14 rounded object-cover" />
                        <button
                          type="button"
                          onClick={() => setPhotos((ps) => ps.filter((_, j) => j !== i))}
                          className="absolute -right-1 -top-1 rounded-full bg-destructive p-0.5 text-destructive-foreground"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {videos.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {videos.map((v, i) => (
                      <div key={i} className="flex items-center justify-between rounded border p-2 text-xs">
                        <span className="flex items-center gap-1 truncate">
                          <VideoIcon className="h-3 w-3 shrink-0" /> {v.name}
                        </span>
                        <button type="button" onClick={() => setVideos((vs) => vs.filter((_, j) => j !== i))}>
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
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
                tenantCode: form.tenantCode || undefined,
                managerName: form.managerName || undefined,
                managerPhone: form.managerPhone || undefined,
                managerEmail: form.managerEmail || undefined,
                councilRateRef: form.councilRateRef || undefined,
                waterAccountRef: form.waterAccountRef || undefined,
                purchasePrice: parseFloat(form.purchasePrice) || 0,
                currentValue: parseFloat(form.currentValue) || 0,
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
                councilRatesAnnual: form.councilRatesAnnual ? parseFloat(form.councilRatesAnnual) : undefined,
                waterRatesAnnual: form.waterRatesAnnual ? parseFloat(form.waterRatesAnnual) : undefined,
                insuranceAnnual: form.insuranceAnnual ? parseFloat(form.insuranceAnnual) : undefined,
                strataFeesAnnual: form.strataFeesAnnual ? parseFloat(form.strataFeesAnnual) : undefined,
                landTaxAnnual: form.landTaxAnnual ? parseFloat(form.landTaxAnnual) : undefined,
                repairsMaintenanceAnnual: form.repairsMaintenanceAnnual
                  ? parseFloat(form.repairsMaintenanceAnnual)
                  : undefined,
                pmFeePercent: form.pmFeePercent ? parseFloat(form.pmFeePercent) : undefined,
                inspectionFrequencyMonths: form.inspectionFrequencyMonths
                  ? parseInt(form.inspectionFrequencyMonths, 10)
                  : undefined,
                entityId:
                  creatingEntity && newEntityName.trim()
                    ? findOrCreateEntity(newEntityName, newEntityType)
                    : form.entityId || undefined,
                occupancyType: form.occupancyType || undefined,
                strataLevyAmount: form.strataLevyAmount ? parseFloat(form.strataLevyAmount) : undefined,
                strataLevyFrequency: (form.strataLevyFrequency || undefined) as Property["strataLevyFrequency"],
                insurerName: form.insurerName || undefined,
                insurancePolicyNumber: form.insurancePolicyNumber || undefined,
                insurancePremium: form.insurancePremium ? parseFloat(form.insurancePremium) : undefined,
                insuranceSumInsured: form.insuranceSumInsured ? parseFloat(form.insuranceSumInsured) : undefined,
                insuranceRenewalDate: form.insuranceRenewalDate || undefined,
                smokeAlarmCheckDueDate: form.smokeAlarmCheckDueDate || undefined,
                poolSafetyCertExpiry: form.poolSafetyCertExpiry || undefined,
                notes: form.notes || undefined,
                photos: photos.length > 0 ? photos : undefined,
                videos: videos.length > 0 ? videos : undefined,
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
                const newId = addProperty(payload);
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

export function PropertyOverviewTab({ prop, loan, tenants }: { prop: Property; loan?: Loan; tenants: Tenant[] }) {
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
  const complianceDue = [prop.smokeAlarmCheckDueDate, prop.hasSwimmingPool ? prop.poolSafetyCertExpiry : undefined]
    .filter((d): d is string => !!d)
    .sort()[0];

  return (
    <div className="grid grid-cols-2 gap-3 text-sm">
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
      <Stat label="Insurance expiry" value={prop.insuranceRenewalDate || "—"} />
      <Stat label="Compliance due" value={complianceDue || "—"} />
      <Stat label="YTD income" value={fmtCurrency(ytdIncome)} />
    </div>
  );
}

export function PropertyPurchaseTab({ prop, loan }: { prop: Property; loan?: Loan }) {
  return (
    <div className="grid grid-cols-2 gap-3 text-sm">
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
  );
}

export function PropertyPerformanceTab({ prop, loan, tenants, expenses }: { prop: Property; loan?: Loan; tenants: Tenant[]; expenses: Expense[] }) {
  const currentFY = ausFinancialYear(todayISO());
  const { start, end } = fyRange(currentFY);
  const activeTenant = tenants[0];
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
    <div className="space-y-3 text-sm">
      <p className="text-xs text-muted-foreground">
        Estimates based on the current tenant's rent annualised and this FY's expenses — not a formal valuation.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Gross yield" value={`${grossYield.toFixed(2)}%`} />
        <Stat label="Net yield" value={`${netYield.toFixed(2)}%`} />
        <Stat label="Cash-on-cash return" value={cashOnCash !== undefined ? `${cashOnCash.toFixed(2)}%` : "— (no deposit/stamp duty on file)"} />
        <Stat label="Annualised rent" value={fmtCurrency(annualRent)} />
      </div>
    </div>
  );
}

export function PropertyCostBaseTab({ prop, expenses }: { prop: Property; expenses: Expense[]; depreciationItems: DepreciationItem[] }) {
  const [query, setQuery] = useState("");
  const capitalTx = expenses.filter((e) => e.taxCategory === "Capital Works");
  const capitalWorks = capitalTx.reduce((s, e) => s + e.cost, 0);
  const purchasePrice = prop.purchasePrice + (prop.stampDuty ?? 0);
  const costBase = purchasePrice + capitalWorks;

  const byCategory = capitalTx.reduce<Record<string, number>>((acc, e) => {
    acc[e.itemName] = (acc[e.itemName] ?? 0) + e.cost;
    return acc;
  }, {});
  const categoryEntries = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);

  const filtered = capitalTx
    .filter((e) => !query || e.itemName.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const purchasePct = costBase > 0 ? Math.round((purchasePrice / costBase) * 100) : 0;

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
                <Stat label="Purchase price" value={fmtCurrency(purchasePrice)} />
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
                  <span className="font-medium">{fmtCurrency(purchasePrice)}</span>
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

function NewDepreciationItemDialog({ assetId }: { assetId?: string }) {
  const { addDepreciationItem } = useStore();
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [purchaseCost, setPurchaseCost] = useState("");
  const [effectiveLifeYears, setEffectiveLifeYears] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(todayISO());
  const [method, setMethod] = useState<NonNullable<DepreciationItem["method"]>>("Diminishing Value");
  const [division, setDivision] = useState<NonNullable<DepreciationItem["division"]>>("Div 40");

  const onDescriptionBlur = () => {
    if (effectiveLifeYears) return;
    const suggested = suggestEffectiveLife(description);
    if (suggested) setEffectiveLifeYears(String(suggested));
  };

  const save = () => {
    if (!assetId) return;
    if (!description.trim()) return toast.error("Description required");
    const cost = parseFloat(purchaseCost);
    if (!cost || cost <= 0) return toast.error("Cost must be greater than 0");
    addDepreciationItem({
      assetId,
      description: description.trim(),
      purchaseCost: cost,
      effectiveLifeYears: parseFloat(effectiveLifeYears) || 1,
      purchaseDate: purchaseDate || undefined,
      method,
      division,
    });
    toast.success("Depreciation item added");
    setOpen(false);
    setDescription("");
    setPurchaseCost("");
    setEffectiveLifeYears("");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1">
          <Plus className="h-3 w-3" /> Add one-off item
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New depreciation item</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Field label="Item name">
              <Input value={description} onChange={(e) => setDescription(e.target.value)} onBlur={onDescriptionBlur} placeholder="e.g. hot water system, carpet, air conditioner" />
            </Field>
          </div>
          <Field label="Cost">
            <Input type="number" value={purchaseCost} onChange={(e) => setPurchaseCost(e.target.value)} />
          </Field>
          <Field label="Effective life (years)">
            <Input type="number" value={effectiveLifeYears} onChange={(e) => setEffectiveLifeYears(e.target.value)} placeholder="Auto-fills from item name" />
          </Field>
          <Field label="Method">
            <Select value={method} onValueChange={(v) => setMethod(v as typeof method)}>
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
            <Select value={division} onValueChange={(v) => setDivision(v as typeof division)}>
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
        <DialogFooter>
          <Button onClick={save}>Add item</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DepreciationTab({ assetId }: { assetId?: string }) {
  const { state, deleteDepreciationItem } = useStore();

  const items = assetId ? state.depreciationItems.filter((d) => d.assetId === assetId) : [];
  const schedule = buildDepreciationSchedule(items);

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
            <div className="space-y-2">
              {items.map((d) => (
                <div key={d.id} className="flex items-center justify-between rounded border p-2 text-xs">
                  <div>
                    <div className="flex items-center gap-1.5 font-medium">
                      {d.description}
                      {d.division && <Badge variant="outline" className="text-[10px]">{d.division}</Badge>}
                      {d.quantitySurveyor && <Badge variant="secondary" className="text-[10px]">{d.quantitySurveyor}</Badge>}
                    </div>
                    <div className="text-muted-foreground">
                      {fmtCurrency(d.purchaseCost)} over {d.effectiveLifeYears}y · {d.method ?? "Diminishing Value"}
                    </div>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={() => {
                      deleteDepreciationItem(d.id);
                      toast.success("Removed");
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

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
    </div>
  );
}

export function PropertyPnLTab({ prop, loan, tenants, expenses }: { prop: Property; loan?: Loan; tenants: Tenant[]; expenses: Expense[] }) {
  const { state } = useStore();
  const currentFY = ausFinancialYear(todayISO());
  const { start, end } = fyRange(currentFY);
  const tenantIds = tenants.map((t) => t.id);
  const grossRent = state.ledger
    .filter((e) => tenantIds.includes(e.tenantId) && e.type === "Rent Payment" && e.date >= start && e.date <= end)
    .reduce((s, e) => s + e.credit, 0);
  const fyExpenses = expenses.filter((e) => e.date >= start && e.date <= end);
  const totalExpenses = fyExpenses.reduce((s, e) => s + e.cost, 0);
  const loanInterest = loan ? (loan.totalBalance * loan.interestRate) / 100 : 0;
  const net = grossRent - totalExpenses - loanInterest;

  return (
    <div className="space-y-3 text-sm">
      <div className="text-xs text-muted-foreground">FY {currentFY}</div>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Gross rent collected" value={fmtCurrency(grossRent)} />
        <Stat label="Total expenses" value={fmtCurrency(totalExpenses)} />
        <Stat label="Loan interest (est.)" value={fmtCurrency(loanInterest)} />
        <Stat label="Net taxable profit / loss" value={fmtCurrency(net)} />
      </div>
      <Button asChild size="sm" variant="outline" className="gap-1">
        <Link to="/transactions">
          Full EOFY report <ArrowRight className="h-3 w-3" />
        </Link>
      </Button>
    </div>
  );
}

export function PropertyDetailsTab({
  prop,
  expenses,
  tenants,
}: {
  prop: Property;
  expenses: Expense[];
  tenants: Tenant[];
}) {
  const { state } = useStore();
  return (
    <div className="space-y-4">
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

      <div>
        <div className="mb-2 text-sm font-medium">Document vault ({expenses.length})</div>
        {expenses.length === 0 && <div className="text-muted-foreground text-xs">No documents.</div>}
        {expenses
          .filter((e) => e.invoiceFileName)
          .map((e) => (
            <div key={e.id} className="flex justify-between rounded border p-2 text-xs">
              <span>{e.itemName}</span>
              {e.invoiceFileData ? (
                <DocumentLink fileName={e.invoiceFileName} fileData={e.invoiceFileData} className="text-primary underline">
                  {e.invoiceFileName}
                </DocumentLink>
              ) : (
                <span className="text-muted-foreground">{e.invoiceFileName}</span>
              )}
            </div>
          ))}
      </div>
    </div>
  );
}

export function PropertyMediaTab({ prop }: { prop: Property }) {
  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 text-sm font-medium">Photos ({prop.photos?.length ?? 0})</div>
        {!prop.photos?.length && <div className="text-xs text-muted-foreground">No photos yet.</div>}
        {!!prop.photos?.length && (
          <div className="flex flex-wrap gap-2">
            {prop.photos.map((p, i) => (
              <a key={i} href={p.data} download={p.name}>
                <img src={p.data} alt={p.name} className="h-20 w-20 rounded object-cover" />
              </a>
            ))}
          </div>
        )}
      </div>
      <div>
        <div className="mb-2 text-sm font-medium">Videos ({prop.videos?.length ?? 0})</div>
        {!prop.videos?.length && <div className="text-xs text-muted-foreground">No videos yet.</div>}
        {prop.videos?.map((v, i) => (
          <div key={i} className="mb-2 rounded border p-2">
            <div className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
              <VideoIcon className="h-3 w-3" /> {v.name}
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
  const { state } = useStore();
  const bills = state.bills.filter((b) => b.propertyId === propertyId);

  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          Bills processed by email, upload or entered here all show up below, with their source document linked.
        </div>
        <AddBillDialog propertyId={propertyId} />
      </div>

      <BillsBoard bills={bills} showPropertyFilter={false} />
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

const PROVIDER_ROLES: ProviderRole[] = ["Council", "Agent", "Insurer", "Trade", "Other"];

interface AgencyAgreementExtractResult {
  ok?: boolean;
  error?: string;
  management_fee_percent?: number | null;
  letting_fee_amount?: number | null;
  letting_fee_weeks_rent?: number | null;
  admin_fee_amount?: number | null;
  admin_fee_frequency?: string | null;
  lease_renewal_fee_amount?: number | null;
  inspection_fee_amount?: number | null;
  advertising_fee_amount?: number | null;
  notice_period_days?: number | null;
  agency_name?: string | null;
  contract_start_date?: string | null;
  contract_review_date?: string | null;
  confidence?: number;
}

const FEE_FREQUENCIES: FeeFrequency[] = ["Per Statement", "Monthly", "Quarterly", "Annually"];

export function ProviderDialog({
  propertyId,
  provider,
  children,
  defaultRole,
}: {
  propertyId: string;
  provider?: Provider;
  children: React.ReactNode;
  /** Pre-selects the role on a brand-new contact (e.g. "Agent" from the Tenancy tab's "Add
   * managing agent" button) instead of always defaulting to "Other". Ignored when editing. */
  defaultRole?: ProviderRole;
}) {
  const { addProvider, updateProvider, state } = useStore();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const propertyUnits = state.properties.find((p) => p.id === propertyId)?.units ?? [];
  const [form, setForm] = useState({
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
    contractFileName: provider?.contractFileName ?? "",
    contractFileData: provider?.contractFileData ?? "",
    managementFeePercent: provider?.managementFeePercent !== undefined ? String(provider.managementFeePercent) : "",
    lettingFeeAmount: provider?.lettingFeeAmount !== undefined ? String(provider.lettingFeeAmount) : "",
    lettingFeeWeeksRent: provider?.lettingFeeWeeksRent !== undefined ? String(provider.lettingFeeWeeksRent) : "",
    adminFeeAmount: provider?.adminFeeAmount !== undefined ? String(provider.adminFeeAmount) : "",
    adminFeeFrequency: provider?.adminFeeFrequency ?? "",
    leaseRenewalFeeAmount: provider?.leaseRenewalFeeAmount !== undefined ? String(provider.leaseRenewalFeeAmount) : "",
    inspectionFeeAmount: provider?.inspectionFeeAmount !== undefined ? String(provider.inspectionFeeAmount) : "",
    advertisingFeeAmount: provider?.advertisingFeeAmount !== undefined ? String(provider.advertisingFeeAmount) : "",
    noticePeriodDays: provider?.noticePeriodDays !== undefined ? String(provider.noticePeriodDays) : "",
    contractStartDate: provider?.contractStartDate ?? "",
    contractReviewDate: provider?.contractReviewDate ?? "",
    contractNotes: provider?.contractNotes ?? "",
  });
  const [extractSummary, setExtractSummary] = useState<{ fields: number; confidence: number } | null>(null);

  const extractContract = async (file: File) => {
    if (file.size > MAX_AI_UPLOAD_BYTES) {
      return toast.error(
        `This file is ${formatFileSize(file.size)} — the AI reader can only handle files up to ${formatFileSize(MAX_AI_UPLOAD_BYTES)}. Try a lower-resolution scan, or split it into smaller files.`,
      );
    }
    setBusy(true);
    setExtractSummary(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Couldn't read file"));
        reader.readAsDataURL(file);
      });
      const base64 = dataUrl.split(",")[1] ?? "";
      setForm((f) => ({ ...f, contractFileName: file.name, contractFileData: base64 }));

      const { data, error } = await supabase.functions.invoke<AgencyAgreementExtractResult>("extract-agency-agreement", {
        body: { fileBase64: base64, fileName: file.name, mimeType: file.type || "application/pdf" },
      });
      if (error) throw error;
      if (!data?.ok) {
        toast.error(data?.error || "Couldn't read this document");
        return;
      }

      let fieldsFound = 0;
      setForm((f) => {
        const next = { ...f };
        if (data.agency_name && !f.name.trim()) {
          next.name = data.agency_name;
          fieldsFound++;
        }
        if (data.management_fee_percent !== undefined && data.management_fee_percent !== null) {
          next.managementFeePercent = String(data.management_fee_percent);
          fieldsFound++;
        }
        if (data.letting_fee_amount !== undefined && data.letting_fee_amount !== null) {
          next.lettingFeeAmount = String(data.letting_fee_amount);
          fieldsFound++;
        }
        if (data.letting_fee_weeks_rent !== undefined && data.letting_fee_weeks_rent !== null) {
          next.lettingFeeWeeksRent = String(data.letting_fee_weeks_rent);
          fieldsFound++;
        }
        if (data.admin_fee_amount !== undefined && data.admin_fee_amount !== null) {
          next.adminFeeAmount = String(data.admin_fee_amount);
          fieldsFound++;
        }
        if (data.admin_fee_frequency) {
          next.adminFeeFrequency = data.admin_fee_frequency;
          fieldsFound++;
        }
        if (data.lease_renewal_fee_amount !== undefined && data.lease_renewal_fee_amount !== null) {
          next.leaseRenewalFeeAmount = String(data.lease_renewal_fee_amount);
          fieldsFound++;
        }
        if (data.inspection_fee_amount !== undefined && data.inspection_fee_amount !== null) {
          next.inspectionFeeAmount = String(data.inspection_fee_amount);
          fieldsFound++;
        }
        if (data.advertising_fee_amount !== undefined && data.advertising_fee_amount !== null) {
          next.advertisingFeeAmount = String(data.advertising_fee_amount);
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
  };

  const save = () => {
    if (!form.name.trim()) {
      toast.error("Name is required");
      return;
    }
    const num = (s: string) => (s.trim() ? parseFloat(s) : undefined);
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
      contractFileName: form.contractFileName || undefined,
      contractFileData: form.contractFileData || undefined,
      managementFeePercent: num(form.managementFeePercent),
      lettingFeeAmount: num(form.lettingFeeAmount),
      lettingFeeWeeksRent: num(form.lettingFeeWeeksRent),
      adminFeeAmount: num(form.adminFeeAmount),
      adminFeeFrequency: (form.adminFeeFrequency || undefined) as FeeFrequency | undefined,
      leaseRenewalFeeAmount: num(form.leaseRenewalFeeAmount),
      inspectionFeeAmount: num(form.inspectionFeeAmount),
      advertisingFeeAmount: num(form.advertisingFeeAmount),
      noticePeriodDays: num(form.noticePeriodDays),
      contractStartDate: form.contractStartDate || undefined,
      contractReviewDate: form.contractReviewDate || undefined,
      contractNotes: form.contractNotes.trim() || undefined,
    };
    if (provider) {
      updateProvider(provider.id, payload);
      toast.success("Contact updated");
    } else {
      addProvider({ propertyId, ...payload });
      toast.success("Contact added");
    }
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
                    {r}
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

        {form.role === "Agent" && (
          <div className="col-span-2 space-y-3 rounded-md border p-3">
            <div className="text-xs font-medium">Management agreement</div>
            <div className="flex items-center gap-2">
              <Input
                type="file"
                accept="application/pdf,image/*"
                className="h-8 text-xs"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void extractContract(f);
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
              <Field label="Management fee (%)">
                <Input
                  type="number"
                  value={form.managementFeePercent}
                  onChange={(e) => setForm((f) => ({ ...f, managementFeePercent: e.target.value }))}
                  placeholder="e.g. 6.6"
                />
              </Field>
              <Field label="Letting fee ($ flat)">
                <Input
                  type="number"
                  value={form.lettingFeeAmount}
                  onChange={(e) => setForm((f) => ({ ...f, lettingFeeAmount: e.target.value }))}
                />
              </Field>
              <Field label="— or letting fee (weeks' rent)">
                <Input
                  type="number"
                  value={form.lettingFeeWeeksRent}
                  onChange={(e) => setForm((f) => ({ ...f, lettingFeeWeeksRent: e.target.value }))}
                  placeholder="e.g. 1"
                />
              </Field>
              <Field label="Admin / statement fee ($)">
                <Input
                  type="number"
                  value={form.adminFeeAmount}
                  onChange={(e) => setForm((f) => ({ ...f, adminFeeAmount: e.target.value }))}
                />
              </Field>
              <Field label="Admin fee frequency">
                <Select
                  value={form.adminFeeFrequency}
                  onValueChange={(v) => setForm((f) => ({ ...f, adminFeeFrequency: v }))}
                >
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
              <Field label="Lease renewal fee ($)">
                <Input
                  type="number"
                  value={form.leaseRenewalFeeAmount}
                  onChange={(e) => setForm((f) => ({ ...f, leaseRenewalFeeAmount: e.target.value }))}
                />
              </Field>
              <Field label="Inspection fee ($)">
                <Input
                  type="number"
                  value={form.inspectionFeeAmount}
                  onChange={(e) => setForm((f) => ({ ...f, inspectionFeeAmount: e.target.value }))}
                />
              </Field>
              <Field label="Advertising / marketing fee ($)">
                <Input
                  type="number"
                  value={form.advertisingFeeAmount}
                  onChange={(e) => setForm((f) => ({ ...f, advertisingFeeAmount: e.target.value }))}
                />
              </Field>
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
        )}

        <DialogFooter>
          <Button onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ProviderRow({ provider }: { provider: Provider }) {
  const { deleteProvider } = useStore();
  const details = [provider.email, provider.phone, provider.website].filter(Boolean).join(" · ");
  return (
    <div className="flex items-start justify-between gap-2 rounded border p-2 text-xs">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium">{provider.name}</span>
          <Badge variant="secondary" className="text-[10px]">
            {provider.role}
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
        {provider.role === "Agent" && hasFeeTerms(provider) && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-muted-foreground">
            {provider.managementFeePercent !== undefined && <span>Mgmt fee {provider.managementFeePercent}%</span>}
            {provider.lettingFeeAmount !== undefined && <span>Letting {fmtCurrency(provider.lettingFeeAmount)}</span>}
            {provider.lettingFeeWeeksRent !== undefined && <span>Letting {provider.lettingFeeWeeksRent} wk rent</span>}
            {provider.adminFeeAmount !== undefined && <span>Admin {fmtCurrency(provider.adminFeeAmount)}</span>}
            {provider.advertisingFeeAmount !== undefined && <span>Advertising {fmtCurrency(provider.advertisingFeeAmount)}</span>}
            {provider.noticePeriodDays !== undefined && <span>Notice {provider.noticePeriodDays} days</span>}
            {provider.contractFileData && (
              <button
                type="button"
                onClick={() => openBillDocument(provider.contractFileName, provider.contractFileData)}
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
        <ProviderDialog propertyId={provider.propertyId ?? ""} provider={provider}>
          <Button size="icon" variant="ghost" className="h-6 w-6">
            <Pencil className="h-3 w-3" />
          </Button>
        </ProviderDialog>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          onClick={() => {
            if (confirm(`Delete contact "${provider.name}"?`)) {
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
  const agent = state.providers.find((p) => p.propertyId === propertyId && p.role === "Agent");

  return (
    <div className="space-y-5 text-sm">
      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-medium">Managing agent</div>
            <div className="text-xs text-muted-foreground">
              Upload the signed management agreement to auto-fill the agency's contact details and fee terms.
            </div>
          </div>
          <ProviderDialog propertyId={propertyId} provider={agent} defaultRole="Agent">
            <Button size="sm" variant="outline" className="shrink-0 gap-1">
              {agent ? (
                <>
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </>
              ) : (
                <>
                  <Plus className="h-3.5 w-3.5" /> Add managing agent
                </>
              )}
            </Button>
          </ProviderDialog>
        </div>
        {agent ? (
          <ProviderRow provider={agent} />
        ) : (
          <div className="rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground">
            No managing agent on file for this property yet.
          </div>
        )}
      </div>

      {agent && (
        <div className="border-t pt-4">
          <div className="mb-2 text-sm font-medium">Fee verification</div>
          <PropertyFeeVerificationTab propertyId={propertyId} />
        </div>
      )}
    </div>
  );
}

/**
 * On-demand fee-verification report for one property — aggregates every rent payment and every
 * posted "Property Agent Fees" expense in a chosen financial year and checks the totals against
 * the property's Agent provider's management-agreement terms. Same comparison engine
 * (verifyAgentFees) as the inline per-statement check in RentLedgerProposalCard, just run over a
 * whole year of posted records instead of one statement still in review.
 */
export function PropertyFeeVerificationTab({ propertyId }: { propertyId: string }) {
  const { state } = useStore();
  const currentFY = ausFinancialYear(todayISO());
  const [fy, setFy] = useState(currentFY);
  const agent = state.providers.find((p) => p.propertyId === propertyId && p.role === "Agent");

  const fys = (() => {
    const years: string[] = [];
    const currentYear = new Date().getFullYear();
    for (let y = currentYear - 3; y <= currentYear + 1; y++) years.push(`${y}-${y + 1}`);
    return years;
  })();

  if (!agent) {
    return (
      <div className="text-sm text-muted-foreground">
        No managing agent on file for this property yet — add one under Providers with role "Agent" to enable fee
        verification.
      </div>
    );
  }
  if (!hasFeeTerms(agent)) {
    return (
      <div className="text-sm text-muted-foreground">
        {agent.name} has no management-agreement fee terms on file yet — open their contact under Providers and
        upload the signed agreement (or enter the fees manually) to enable verification.
      </div>
    );
  }

  const { start, end } = fyRange(fy);
  const tenantIds = state.tenants.filter((t) => t.propertyId === propertyId).map((t) => t.id);
  const rentCollected = state.ledger
    .filter((e) => tenantIds.includes(e.tenantId) && e.type === "Rent Payment" && e.date >= start && e.date <= end)
    .reduce((s, e) => s + e.credit, 0);
  const expensesInRange = state.expenses.filter((e) => e.propertyId === propertyId && e.date >= start && e.date <= end);
  const results = verifyAgentFees({ provider: agent, rentCollected, lines: collectAgentFeeLines(expensesInRange) });
  const totalExpected = results.reduce((s, r) => s + (r.expected ?? 0), 0);
  const totalActual = results.reduce((s, r) => s + r.actual, 0);
  const flagged = results.filter((r) => r.status === "overcharge" || r.status === "not_charged" || r.status === "unspecified");

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">
          Checks total rent collected and every posted agent-fee expense against {agent.name}'s management
          agreement.
        </div>
        <Select value={fy} onValueChange={setFy}>
          <SelectTrigger className="w-[130px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
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
          <div className="text-lg font-semibold">{fmtCurrency(rentCollected)}</div>
        </div>
        <div className="rounded border p-3">
          <div className="text-xs text-muted-foreground">Agent fees charged</div>
          <div className="text-lg font-semibold">{fmtCurrency(totalActual)}</div>
        </div>
        <div className="rounded border p-3">
          <div className="text-xs text-muted-foreground">Agreed (expected)</div>
          <div className="text-lg font-semibold">{fmtCurrency(totalExpected)}</div>
        </div>
      </div>

      {results.length === 0 ? (
        <div className="rounded border p-3 text-xs text-muted-foreground">
          No rent collected and no agent fees posted for FY {fy}.
        </div>
      ) : (
        <div className="space-y-1">
          {results.map((r) => (
            <FeeCheckRow key={r.type} result={r} />
          ))}
        </div>
      )}

      {flagged.length > 0 && (
        <div className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
          {flagged.length} item{flagged.length === 1 ? "" : "s"} worth a closer look this year — see above.
        </div>
      )}
    </div>
  );
}

export function PropertyProvidersTab({ propertyId }: { propertyId: string }) {
  const { state } = useStore();
  const providers = state.providers.filter((p) => p.propertyId === propertyId);
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
          <ProviderRow key={p.id} provider={p} />
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

  const label = property.alias || property.address;
  const tenantIds = state.tenants.filter((t) => t.propertyId === property.id).map((t) => t.id);
  const tenantCount = tenantIds.length;
  const ledgerCount = state.ledger.filter((e) => tenantIds.includes(e.tenantId)).length;
  const billCount = state.bills.filter((b) => b.propertyId === property.id).length;
  const expenseCount = state.expenses.filter((e) => e.propertyId === property.id).length;
  const loanCount = state.loans.filter((l) => l.propertyId === property.id).length;
  const providerCount = state.providers.filter((p) => p.propertyId === property.id).length;
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
    const reader = new FileReader();
    reader.onload = () => {
      setDocFileName(f.name);
      setDocFileData(String(reader.result));
    };
    reader.readAsDataURL(f);
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
  const [form, setForm] = useState({
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
    const reader = new FileReader();
    reader.onload = () =>
      setForm((s) => ({ ...s, [`${key}FileName`]: f.name, [`${key}FileData`]: String(reader.result) } as typeof s));
    reader.readAsDataURL(f);
  };
  const onLeaseFile = (f: File | undefined) => onFile("leaseDocument", f);

  const check12Months = () => {
    if (!tenant) return true;
    return checkRentIncreaseCompliance(tenant, parseFloat(form.rentAmount), state.rentChanges);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-muted p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}
