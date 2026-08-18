import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
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
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
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
  Mail,
  Sparkles,
  TrendingUp,
  TriangleAlert,
  IdCard,
  ArrowRight,
} from "lucide-react";
import { fmtCurrency, todayISO, ausFinancialYear, fyRange, daysUntil } from "@/lib/calculations";
import type {
  Property,
  Tenant,
  RentFrequency,
  LeaseDuration,
  RepaymentFrequency,
  BillType,
  PropertyBill,
  AiIntakeProposal,
  TenantLeaseProposalPayload,
  RentLedgerProposalPayload,
  PropertyDetailProposalPayload,
  RentChange,
  LeaseHistory,
  ContactPerson,
  Provider,
  ProviderRole,
  DepreciationItem,
  Loan,
  Expense,
} from "@/lib/types";
import { toast } from "sonner";
import { BillRow } from "@/components/BillRow";
import { UploadDocumentDialog } from "@/components/UploadDocumentDialog";
import { fillLeaseTemplate, toDDMMYYYY, appendPdf, SMOKE_ALARM_BATTERY_TYPES } from "@/lib/leaseTemplate";
import { downloadBlob, downloadPdfAndEmailViaGmail } from "@/lib/emailPdf";
import { FileSignature } from "lucide-react";


export const Route = createFileRoute("/portfolio")({
  head: () => ({
    meta: [
      { title: "Portfolio Manager — Landlord OS" },
      { name: "description", content: "Manage properties, tenants, leases and bond records." },
    ],
  }),
  component: PortfolioPage,
});

function PortfolioPage() {
  const { state } = useStore();
  const [openProp, setOpenProp] = useState<Property | null>(null);
  const [drawerId, setDrawerId] = useState<string | null>(null);

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Portfolio Manager</h1>
          <p className="text-sm text-muted-foreground">Properties, tenants and leases.</p>
        </div>
        <PropertyDialog key={openProp?.id ?? "new"} onDone={() => setOpenProp(null)} property={openProp} />
      </div>

      <AiProposalsSection />

      {state.properties.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No properties yet. Add your first property to get started.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {state.properties.map((p) => (
          <PropertyCard key={p.id} property={p} onOpen={() => setDrawerId(p.id)} onEdit={() => setOpenProp(p)} />
        ))}
      </div>

      <PropertyDrawer propertyId={drawerId} onClose={() => setDrawerId(null)} onEdit={(p) => setOpenProp(p)} />
    </div>
  );
}

/** "View PDF" / "View email" affordances for anything with source-document provenance columns. */
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
        <a href={fileData} download={fileName || "document.pdf"} className="inline-flex items-center gap-1 text-primary underline">
          <FileText className="h-3 w-3" /> View PDF
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

function AiProposalsSection() {
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
        {pending.map((p) =>
          p.kind === "tenant_lease" ? (
            <TenantLeaseProposalCard key={p.id} proposal={p} onDismiss={() => dismissProposal(p.id)} />
          ) : p.kind === "property_detail" ? (
            <PropertyDetailProposalCard key={p.id} proposal={p} onDismiss={() => dismissProposal(p.id)} />
          ) : (
            <RentLedgerProposalCard key={p.id} proposal={p} onDismiss={() => dismissProposal(p.id)} />
          ),
        )}
      </CardContent>
    </Card>
  );
}

function TenantLeaseProposalCard({ proposal, onDismiss }: { proposal: AiIntakeProposal; onDismiss: () => void }) {
  const { state, markProposalApplied } = useStore();
  const payload = proposal.payload as TenantLeaseProposalPayload;
  const [propertyId, setPropertyId] = useState(proposal.propertyId ?? "");

  return (
    <Card className="border-amber-500/30">
      <CardContent className="space-y-2 p-4">
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

        <DocumentViewLinks
          fileName={proposal.sourceFileName}
          fileData={proposal.sourceFileData}
          subject={proposal.sourceSubject}
          emailBody={proposal.sourceEmailBody}
        />

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
      </CardContent>
    </Card>
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
];

function PropertyDetailProposalCard({ proposal, onDismiss }: { proposal: AiIntakeProposal; onDismiss: () => void }) {
  const { state, updateProperty, markProposalApplied } = useStore();
  const payload = proposal.payload as PropertyDetailProposalPayload;
  const [propertyId, setPropertyId] = useState(proposal.propertyId ?? "");

  const presentFields = PROPERTY_DETAIL_FIELDS.filter((f) => payload[f.key] !== undefined && payload[f.key] !== null);
  const [checked, setChecked] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(presentFields.map((f) => [f.key, true])),
  );

  const formatValue = (f: (typeof PROPERTY_DETAIL_FIELDS)[number]) => {
    const v = payload[f.key];
    if (f.kind === "currency") return fmtCurrency(v as number);
    return String(v);
  };

  const confirm = () => {
    if (!propertyId) return toast.error("Select a property first");
    const patch: Record<string, unknown> = {};
    presentFields.forEach((f) => {
      if (checked[f.key]) patch[f.key] = payload[f.key];
    });
    if (Object.keys(patch).length === 0) return toast.error("Select at least one field to apply");
    updateProperty(propertyId, patch);
    markProposalApplied(proposal.id);
    toast.success("Property details updated");
  };

  return (
    <Card className="border-amber-500/30">
      <CardContent className="space-y-2 p-4">
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

        {presentFields.length === 0 ? (
          <div className="text-xs text-muted-foreground">No usable fields found on this document.</div>
        ) : (
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
                <span className="font-medium">{formatValue(f)}</span>
              </label>
            ))}
          </div>
        )}

        <DocumentViewLinks
          fileName={proposal.sourceFileName}
          fileData={proposal.sourceFileData}
          subject={proposal.sourceSubject}
          emailBody={proposal.sourceEmailBody}
        />

        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" disabled={!propertyId} onClick={confirm}>
            Apply selected fields
          </Button>
          <Button size="sm" variant="outline" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function RentLedgerProposalCard({ proposal, onDismiss }: { proposal: AiIntakeProposal; onDismiss: () => void }) {
  const { state, addLedger, addExpense, markProposalApplied } = useStore();
  const payload = proposal.payload as RentLedgerProposalPayload;
  const [tenantId, setTenantId] = useState(proposal.matchedTenantId ?? "");
  const [included, setIncluded] = useState<boolean[]>(() => payload.transactions.map(() => true));
  const expenseLines = payload.expenseLines ?? [];
  const [expensesIncluded, setExpensesIncluded] = useState<boolean[]>(() => expenseLines.map(() => true));

  const tenantsAtProperty = proposal.propertyId
    ? state.tenants.filter((t) => t.propertyId === proposal.propertyId)
    : state.tenants;

  const includedIncome = payload.transactions.reduce((s, tx, i) => (included[i] ? s + tx.amount : s), 0);
  const includedExpenses = expenseLines.reduce((s, e, i) => (expensesIncluded[i] ? s + e.amount : s), 0);
  const computedNet = includedIncome - includedExpenses;

  const confirm = () => {
    if (!tenantId) return toast.error("Select a tenant first");
    payload.transactions.forEach((tx, i) => {
      if (!included[i]) return;
      addLedger({
        tenantId,
        date: tx.date,
        type: "Rent Payment",
        description: tx.description,
        debit: 0,
        credit: tx.amount,
        source: "rent_statement",
      });
    });
    expenseLines.forEach((e, i) => {
      if (!expensesIncluded[i]) return;
      addExpense({
        itemName: e.vendor,
        cost: e.amount,
        date: e.date,
        propertyId: proposal.propertyId ?? undefined,
        taxCategory: "Immediate Deduction",
        hasWarranty: false,
        rechargeToTenant: false,
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
    <Card className="border-amber-500/30">
      <CardContent className="space-y-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">Rent statement</Badge>
          {payload.tenantName && <span className="font-medium">{payload.tenantName}</span>}
          <span className="text-xs text-muted-foreground">
            {payload.periodStart || "—"} → {payload.periodEnd || "—"}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Tenant:</span>
          <Select value={tenantId} onValueChange={setTenantId}>
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
          {!proposal.propertyId && proposal.rawPropertyAddress && (
            <span className="text-xs text-destructive">No property matched — "{proposal.rawPropertyAddress}"</span>
          )}
        </div>

        <div className="space-y-1 rounded border p-2">
          <div className="text-[11px] font-medium text-muted-foreground">Rent income → ledger</div>
          {payload.transactions.map((tx, i) => (
            <label key={i} className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={included[i]}
                onChange={(e) => setIncluded((inc) => inc.map((v, j) => (j === i ? e.target.checked : v)))}
              />
              <span className="w-24 shrink-0">{tx.date}</span>
              <span className="w-20 shrink-0 font-medium">{fmtCurrency(tx.amount)}</span>
              <span className="truncate text-muted-foreground">{tx.description}</span>
            </label>
          ))}
        </div>

        {expenseLines.length > 0 && (
          <div className="space-y-1 rounded border p-2">
            <div className="text-[11px] font-medium text-muted-foreground">
              Deductions on this statement → expenses
            </div>
            {expenseLines.map((e, i) => (
              <label key={i} className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={expensesIncluded[i]}
                  onChange={(ev) => setExpensesIncluded((inc) => inc.map((v, j) => (j === i ? ev.target.checked : v)))}
                />
                <span className="w-24 shrink-0">{e.date}</span>
                <span className="w-20 shrink-0 font-medium">{fmtCurrency(e.amount)}</span>
                <span className="w-28 shrink-0 truncate">{e.vendor}</span>
                <span className="truncate text-muted-foreground">{e.description}</span>
              </label>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 rounded border bg-muted/30 p-2 text-xs">
          <span>
            Net (income − deductions): <span className="font-medium">{fmtCurrency(computedNet)}</span>
          </span>
          {payload.netToOwner !== undefined && (
            <span
              className={
                Math.abs(computedNet - payload.netToOwner) < 0.01 ? "text-emerald-600" : "text-destructive"
              }
            >
              Statement says {fmtCurrency(payload.netToOwner)}
              {Math.abs(computedNet - payload.netToOwner) < 0.01 ? " ✓ matches" : " — doesn't match, check inclusions"}
            </span>
          )}
        </div>

        <DocumentViewLinks
          fileName={proposal.sourceFileName}
          fileData={proposal.sourceFileData}
          subject={proposal.sourceSubject}
          emailBody={proposal.sourceEmailBody}
        />

        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" onClick={confirm}>
            Confirm &amp; Add Payments
          </Button>
          <Button size="sm" variant="outline" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PropertyCard({
  property,
  onOpen,
  onEdit,
}: {
  property: Property;
  onOpen: () => void;
  onEdit: () => void;
}) {
  const { state, deleteProperty } = useStore();
  const tenants = state.tenants.filter((t) => t.propertyId === property.id);
  const loan = state.loans.find((l) => l.propertyId === property.id);
  const equity = property.currentValue - (loan?.totalBalance ?? 0);
  return (
    <Card className="group overflow-hidden transition hover:shadow-md">
      <div className="flex h-32 items-center justify-center bg-gradient-to-br from-primary/10 to-accent">
        <Building2 className="h-10 w-10 text-primary/40" />
      </div>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <button className="min-w-0 text-left" onClick={onOpen}>
            <div className="truncate text-sm font-semibold">{property.alias || property.address}</div>
            {property.alias && (
              <div className="truncate text-xs text-muted-foreground">{property.address}</div>
            )}
            <div className="mt-1 text-xs text-muted-foreground">
              {property.currentValue > 0 ? `Value ${fmtCurrency(property.currentValue)}` : "Add portfolio details"}
            </div>
            {property.managerName && (
              <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                <UserCog className="h-3 w-3" /> {property.managerName}
              </div>
            )}
          </button>
          <div className="flex shrink-0 gap-1">
            <Button size="icon" variant="ghost" onClick={onEdit}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => {
                if (confirm("Delete this property and all its tenants/records?")) {
                  deleteProperty(property.id);
                  toast.success("Property removed");
                }
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded bg-muted p-2">
            <div className="text-muted-foreground">Equity</div>
            <div className="font-medium">{fmtCurrency(equity)}</div>
          </div>
          <div className="rounded bg-muted p-2">
            <div className="text-muted-foreground">Tenants</div>
            <div className="font-medium">{tenants.length}</div>
          </div>
        </div>

        <div className="mt-3">
          {tenants.length > 0 ? (
            tenants.map((t) => (
              <div key={t.id} className="mt-2 flex items-center gap-2 text-xs">
                <User className="h-3 w-3" />
                <span className="truncate">
                  {t.name} • {fmtCurrency(t.rentAmount)}/{t.rentFrequency}
                </span>
                {t.bondAmount ? (
                  <Badge variant="secondary" className="gap-1">
                    <ShieldCheck className="h-3 w-3" /> Bond
                  </Badge>
                ) : null}
              </div>
            ))
          ) : (
            <TenantDialog propertyId={property.id}>
              <Button size="sm" variant="outline" className="mt-2 w-full">
                <Plus className="mr-1 h-3 w-3" /> Add Tenant
              </Button>
            </TenantDialog>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function PropertyDialog({ property, onDone }: { property: Property | null; onDone: () => void }) {
  const { state, addProperty, updateProperty } = useStore();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    address: property?.address ?? "",
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
  });
  const [photos, setPhotos] = useState<{ name: string; data: string }[]>(property?.photos ?? []);
  const [videos, setVideos] = useState<{ name: string; data: string }[]>(property?.videos ?? []);
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
      open={open || !!property}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) onDone();
      }}
    >
      <DialogTrigger asChild>
        <Button onClick={() => setOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" /> Add Property
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{property ? "Edit property" : "New property"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Address">
            <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </Field>
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
              <Select
                value={form.entityId || "__none__"}
                onValueChange={(v) => setForm({ ...form, entityId: v === "__none__" ? "" : v })}
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
                </SelectContent>
              </Select>
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
                entityId: form.entityId || undefined,
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
              };
              if (property) updateProperty(property.id, payload);
              else addProperty(payload);
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

function PropertyOverviewTab({ prop, loan, tenants }: { prop: Property; loan?: Loan; tenants: Tenant[] }) {
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

function PropertyPurchaseTab({ prop, loan }: { prop: Property; loan?: Loan }) {
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

function PropertyPerformanceTab({ prop, loan, tenants, expenses }: { prop: Property; loan?: Loan; tenants: Tenant[]; expenses: Expense[] }) {
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

function PropertyCostBaseTab({ prop, expenses, depreciationItems }: { prop: Property; expenses: Expense[]; depreciationItems: DepreciationItem[] }) {
  const capitalWorks = expenses.filter((e) => e.taxCategory === "Capital Works").reduce((s, e) => s + e.cost, 0);
  const costBase = prop.purchasePrice + (prop.stampDuty ?? 0) + capitalWorks;
  const totalDepreciationClaimed = depreciationItems.reduce((s, d) => s + d.purchaseCost, 0);

  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs text-muted-foreground">
        Estimate only — purchase price + stamp duty + capital-works expenses. Not adjusted for depreciation; talk to
        your accountant for the actual CGT cost base.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Purchase price" value={fmtCurrency(prop.purchasePrice)} />
        <Stat label="Stamp duty" value={prop.stampDuty ? fmtCurrency(prop.stampDuty) : "—"} />
        <Stat label="Capital works expenses" value={fmtCurrency(capitalWorks)} />
        <Stat label="Cost base (estimate)" value={fmtCurrency(costBase)} />
        <Stat label="Total depreciation logged" value={fmtCurrency(totalDepreciationClaimed)} />
      </div>
    </div>
  );
}

function DepreciationTab({ assetId }: { assetId?: string }) {
  const { state, addDepreciationItem, deleteDepreciationItem } = useStore();
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [purchaseCost, setPurchaseCost] = useState("");
  const [effectiveLifeYears, setEffectiveLifeYears] = useState("10");
  const [purchaseDate, setPurchaseDate] = useState(todayISO());

  const items = assetId ? state.depreciationItems.filter((d) => d.assetId === assetId) : [];
  const totalAnnual = items.reduce((s, d) => s + d.purchaseCost / (d.effectiveLifeYears || 1), 0);

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
    });
    toast.success("Depreciation item added");
    setOpen(false);
    setDescription("");
    setPurchaseCost("");
  };

  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs text-muted-foreground">
        A simplified prime-cost log (cost ÷ effective life = annual claim) — not a full ATO Div 40/43
        diminishing-value schedule. Use as a running reference, not tax advice.
      </p>
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" className="gap-1">
              <Plus className="h-3 w-3" /> Add item
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New depreciation item</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Field label="Description">
                  <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Carpet, hot water system" />
                </Field>
              </div>
              <Field label="Cost">
                <Input type="number" value={purchaseCost} onChange={(e) => setPurchaseCost(e.target.value)} />
              </Field>
              <Field label="Effective life (years)">
                <Input type="number" value={effectiveLifeYears} onChange={(e) => setEffectiveLifeYears(e.target.value)} />
              </Field>
              <Field label="Purchase date">
                <Input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
              </Field>
            </div>
            <DialogFooter>
              <Button onClick={save}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      {items.length === 0 && <div className="text-xs text-muted-foreground">No depreciation items logged.</div>}
      {items.map((d) => (
        <div key={d.id} className="flex items-center justify-between rounded border p-2 text-xs">
          <div>
            <div className="font-medium">{d.description}</div>
            <div className="text-muted-foreground">
              {fmtCurrency(d.purchaseCost)} over {d.effectiveLifeYears}y — {fmtCurrency(d.purchaseCost / (d.effectiveLifeYears || 1))}/yr
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
      {items.length > 0 && (
        <div className="flex justify-between border-t pt-2 text-xs font-medium">
          <span>Total annual claim</span>
          <span>{fmtCurrency(totalAnnual)}</span>
        </div>
      )}
    </div>
  );
}

function PropertyPnLTab({ prop, loan, tenants, expenses }: { prop: Property; loan?: Loan; tenants: Tenant[]; expenses: Expense[] }) {
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
        <Link to="/expenses">
          Full EOFY report <ArrowRight className="h-3 w-3" />
        </Link>
      </Button>
    </div>
  );
}

function PropertyComplianceTab({ prop }: { prop: Property }) {
  return (
    <div className="space-y-4 text-sm">
      <div>
        <div className="mb-2 text-xs font-medium text-muted-foreground">Strata</div>
        <div className="grid grid-cols-2 gap-3">
          <Stat
            label="Levy"
            value={prop.strataLevyAmount ? `${fmtCurrency(prop.strataLevyAmount)} / ${prop.strataLevyFrequency ?? "—"}` : "—"}
          />
        </div>
      </div>
      <div>
        <div className="mb-2 text-xs font-medium text-muted-foreground">Insurance</div>
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Insurer" value={prop.insurerName || "—"} />
          <Stat label="Policy number" value={prop.insurancePolicyNumber || "—"} />
          <Stat label="Premium" value={prop.insurancePremium ? fmtCurrency(prop.insurancePremium) : "—"} />
          <Stat label="Sum insured" value={prop.insuranceSumInsured ? fmtCurrency(prop.insuranceSumInsured) : "—"} />
          <Stat label="Renewal date" value={prop.insuranceRenewalDate || "—"} />
        </div>
      </div>
      <div>
        <div className="mb-2 text-xs font-medium text-muted-foreground">Compliance</div>
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Smoke alarm check due" value={prop.smokeAlarmCheckDueDate || "—"} />
          {prop.hasSwimmingPool && <Stat label="Pool safety cert expiry" value={prop.poolSafetyCertExpiry || "—"} />}
        </div>
      </div>
    </div>
  );
}

function PropertyDrawer({
  propertyId,
  onClose,
  onEdit,
}: {
  propertyId: string | null;
  onClose: () => void;
  onEdit: (p: Property) => void;
}) {
  const { state } = useStore();
  const prop = state.properties.find((p) => p.id === propertyId);
  const tenants = state.tenants.filter((t) => t.propertyId === propertyId);
  const loan = state.loans.find((l) => l.propertyId === propertyId);
  const expenses = state.expenses.filter((e) => e.propertyId === propertyId);
  return (
    <Sheet open={!!propertyId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-4xl overflow-y-auto">
        <SheetHeader>
          <div className="flex items-center justify-between gap-2 pr-8">
            <div>
              <SheetTitle>{prop?.alias || prop?.address}</SheetTitle>
              {prop?.alias && <div className="text-xs text-muted-foreground">{prop.address}</div>}
            </div>
            {prop && (
              <div className="flex shrink-0 gap-2">
                <UploadDocumentDialog />
                <Button size="sm" variant="outline" className="gap-1" onClick={() => onEdit(prop)}>
                  <Pencil className="h-3.5 w-3.5" /> Edit property
                </Button>
              </div>
            )}
          </div>
        </SheetHeader>
        {prop && (
          <Tabs defaultValue="overview" className="mt-4">
            <TabsList className="flex-wrap h-auto">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="purchase">Purchase &amp; Settlement</TabsTrigger>
              <TabsTrigger value="performance">Performance</TabsTrigger>
              <TabsTrigger value="costbase">Cost Base</TabsTrigger>
              <TabsTrigger value="depreciation">Depreciation</TabsTrigger>
              <TabsTrigger value="pnl">P&amp;L</TabsTrigger>
              <TabsTrigger value="compliance">Compliance</TabsTrigger>
              <TabsTrigger value="housekeeping">Housekeeping &amp; Bills</TabsTrigger>
              <TabsTrigger value="providers">Providers</TabsTrigger>
              <TabsTrigger value="media">Media</TabsTrigger>
            </TabsList>
            <TabsContent value="overview" className="text-sm">
              <PropertyOverviewTab prop={prop} loan={loan} tenants={tenants} />
            </TabsContent>
            <TabsContent value="purchase" className="text-sm">
              <PropertyPurchaseTab prop={prop} loan={loan} />
            </TabsContent>
            <TabsContent value="performance" className="text-sm">
              <PropertyPerformanceTab prop={prop} loan={loan} tenants={tenants} expenses={expenses} />
            </TabsContent>
            <TabsContent value="costbase" className="text-sm">
              <PropertyCostBaseTab
                prop={prop}
                expenses={expenses}
                depreciationItems={prop.assetId ? state.depreciationItems.filter((d) => d.assetId === prop.assetId) : []}
              />
            </TabsContent>
            <TabsContent value="depreciation" className="text-sm">
              <DepreciationTab assetId={prop.assetId} />
            </TabsContent>
            <TabsContent value="pnl" className="text-sm">
              <PropertyPnLTab prop={prop} loan={loan} tenants={tenants} expenses={expenses} />
            </TabsContent>
            <TabsContent value="compliance" className="text-sm">
              <PropertyComplianceTab prop={prop} />
            </TabsContent>
            <TabsContent value="details" className="space-y-4 text-sm">
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
                  <div className="whitespace-pre-wrap rounded bg-muted p-3">{prop.notes}</div>
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
                        <a href={e.invoiceFileData} download={e.invoiceFileName} className="text-primary underline">
                          {e.invoiceFileName}
                        </a>
                      ) : (
                        <span className="text-muted-foreground">{e.invoiceFileName}</span>
                      )}
                    </div>
                  ))}
              </div>
            </TabsContent>
            <TabsContent value="housekeeping">
              <PropertyBillsTab propertyId={prop.id} />
            </TabsContent>
            <TabsContent value="providers">
              <PropertyProvidersTab propertyId={prop.id} />
            </TabsContent>
            <TabsContent value="media" className="space-y-4 text-sm">
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
            </TabsContent>
          </Tabs>
        )}
      </SheetContent>
    </Sheet>
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

    propertyAddress: property.address,
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

function PropertyBillsTab({ propertyId }: { propertyId: string }) {
  const { state, addBill, deleteBill, markBillPaid } = useStore();
  const bills = state.bills.filter((b) => b.propertyId === propertyId);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    billType: "Water" as BillType,
    amount: "",
    dueDate: todayISO(),
    portalUrl: "",
    portalUsername: "",
    passwordNote: "",
    notes: "",
    recurrenceMonths: "",
  });

  const save = () => {
    if (!form.amount) return toast.error("Amount required");
    addBill({
      propertyId,
      billType: form.billType,
      amount: parseFloat(form.amount) || 0,
      dueDate: form.dueDate,
      status: "Unpaid",
      portalUrl: form.portalUrl || undefined,
      portalUsername: form.portalUsername || undefined,
      passwordNote: form.passwordNote || undefined,
      notes: form.notes || undefined,
      recurrenceMonths: form.recurrenceMonths ? parseInt(form.recurrenceMonths, 10) : undefined,
    });
    setOpen(false);
    setForm({ billType: "Water", amount: "", dueDate: todayISO(), portalUrl: "", portalUsername: "", passwordNote: "", notes: "", recurrenceMonths: "" });
    toast.success("Bill added");
  };

  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          Utility portal credentials are stored locally in your browser only.
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1"><Plus className="h-3 w-3" /> Add Bill</Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
            <DialogHeader><DialogTitle>New bill</DialogTitle></DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Bill type">
                <Select value={form.billType} onValueChange={(v) => setForm({ ...form, billType: v as BillType })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(["Water","Council Rates","Strata","Insurance","Electricity","Gas","Other"] as BillType[]).map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Amount (AUD)">
                <Input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              </Field>
              <Field label="Due date">
                <Input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
              </Field>
              <Field label="Recurrence (months)">
                <Input type="number" placeholder="e.g. 3 for quarterly" value={form.recurrenceMonths} onChange={(e) => setForm({ ...form, recurrenceMonths: e.target.value })} />
              </Field>
              <Field label="Portal URL">
                <Input value={form.portalUrl} onChange={(e) => setForm({ ...form, portalUrl: e.target.value })} placeholder="https://…" />
              </Field>
              <Field label="Portal username">
                <Input value={form.portalUsername} onChange={(e) => setForm({ ...form, portalUsername: e.target.value })} />
              </Field>
              <Field label="Password note (stored locally)">
                <Input value={form.passwordNote} onChange={(e) => setForm({ ...form, passwordNote: e.target.value })} />
              </Field>
              <Field label="Notes">
                <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </Field>
            </div>
            <DialogFooter><Button onClick={save}>Save</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {bills.length === 0 && (
        <div className="rounded-md border p-4 text-center text-muted-foreground text-xs">
          No bills yet. Add water, rates, strata or insurance bills to track them here.
        </div>
      )}

      {bills.sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1)).map((b) => (
        <BillRow key={b.id} bill={b} onPaid={() => { markBillPaid(b.id); toast.success("Marked paid" + (b.recurrenceMonths ? " — next cycle scheduled" : "")); }} onDelete={() => { deleteBill(b.id); toast.success("Bill removed"); }} />
      ))}
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
          <a
            href={entry.leaseDocumentFileData}
            download={entry.leaseDocumentFileName || "lease.pdf"}
            className="text-primary underline"
          >
            View lease
          </a>
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

function ProviderDialog({
  propertyId,
  provider,
  children,
}: {
  propertyId: string;
  provider?: Provider;
  children: React.ReactNode;
}) {
  const { addProvider, updateProvider } = useStore();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: provider?.name ?? "",
    role: provider?.role ?? ("Other" as ProviderRole),
    email: provider?.email ?? "",
    phone: provider?.phone ?? "",
    website: provider?.website ?? "",
    abn: provider?.abn ?? "",
    address: provider?.address ?? "",
    notes: provider?.notes ?? "",
  });

  const save = () => {
    if (!form.name.trim()) {
      toast.error("Name is required");
      return;
    }
    const payload = {
      name: form.name.trim(),
      role: form.role,
      email: form.email.trim() || undefined,
      phone: form.phone.trim() || undefined,
      website: form.website.trim() || undefined,
      abn: form.abn.trim() || undefined,
      address: form.address.trim() || undefined,
      notes: form.notes.trim() || undefined,
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
      <DialogContent>
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
          <div className="col-span-2">
            <Field label="Notes">
              <Textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={2} />
            </Field>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProviderRow({ provider }: { provider: Provider }) {
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

function PropertyProvidersTab({ propertyId }: { propertyId: string }) {
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
  /** Called after the tenant is actually saved (not when the dialog merely opens). */
  onSaved?: () => void;
  children?: React.ReactNode;
}) {
  const { addTenant, updateTenant, state } = useStore();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: tenant?.name ?? initialValues?.name ?? "",
    email: tenant?.email ?? initialValues?.email ?? "",
    phone: tenant?.phone ?? initialValues?.phone ?? "",
    emergencyContactName: tenant?.emergencyContactName ?? "",
    emergencyContactRelationship: tenant?.emergencyContactRelationship ?? "",
    emergencyContactPhone: tenant?.emergencyContactPhone ?? "",
    permanentAddress: tenant?.permanentAddress ?? "",
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
              if (tenant) updateTenant(tenant.id, payload);
              else addTenant(payload);
              setOpen(false);
              onSaved?.();
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
