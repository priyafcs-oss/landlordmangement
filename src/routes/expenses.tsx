import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useStore } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Plus,
  Trash2,
  FileText,
  Download,
  Wrench,
  TriangleAlert,
  Check,
  DollarSign,
  Pencil,
  Copy,
  Mail,
} from "lucide-react";
import { fmtCurrency, ausFinancialYear, fyRange, todayISO } from "@/lib/calculations";
import { toast } from "sonner";
import type { Expense } from "@/lib/types";


export const Route = createFileRoute("/expenses")({
  head: () => ({
    meta: [
      { title: "Expenses & Tax — Landlord OS" },
      { name: "description", content: "Log expenses and generate EOFY tax summaries." },
    ],
  }),
  component: ExpensesPage,
});

function ExpensesPage() {
  const { state } = useStore();
  const currentFY = ausFinancialYear(todayISO());
  const [fy, setFy] = useState(currentFY);

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Expenses &amp; Tax</h1>
        <p className="text-sm text-muted-foreground">
          Log outgoings and generate ATO-ready EOFY reports.
        </p>
      </div>

      <Tabs defaultValue="expenses">
        <TabsList>
          <TabsTrigger value="expenses">Expenses</TabsTrigger>
          <TabsTrigger value="eofy">EOFY Report</TabsTrigger>
        </TabsList>

        <TabsContent value="expenses" className="mt-4">
          <ExpensesTab fy={fy} setFy={setFy} />
        </TabsContent>
        <TabsContent value="eofy" className="mt-4">
          <EofyReport />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ExpensesTab({ fy, setFy }: { fy: string; setFy: (v: string) => void }) {
  const { state, deleteExpense } = useStore();
  const { start, end } = fyRange(fy);
  const [propertyId, setPropertyId] = useState("__all__");
  const [tenantId, setTenantId] = useState("__all__");

  const tenantOptions =
    propertyId === "__all__" ? state.tenants : state.tenants.filter((t) => t.propertyId === propertyId);

  const filtered = state.expenses.filter((e) => {
    if (e.date < start || e.date > end) return false;
    if (propertyId !== "__all__" && e.propertyId !== propertyId) return false;
    if (tenantId !== "__all__" && e.tenantId !== tenantId) return false;
    return true;
  });

  const fys = useMemo(() => {
    const years: string[] = [];
    const currentYear = new Date().getFullYear();
    for (let y = currentYear - 3; y <= currentYear + 1; y++) {
      years.push(`${y}-${y + 1}`);
    }
    return years;
  }, []);

  return (
    <div className="space-y-4">
      <NeedsReviewBanner />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={fy} onValueChange={setFy}>
            <SelectTrigger className="w-[160px]">
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
          <Select
            value={propertyId}
            onValueChange={(v) => {
              setPropertyId(v);
              setTenantId("__all__");
            }}
          >
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
          <Select value={tenantId} onValueChange={setTenantId}>
            <SelectTrigger className="w-[180px]">
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
        </div>
        <ExpenseDialog />
      </div>

      <div className="grid gap-3">
        {filtered.length === 0 && (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              No expenses logged for FY {fy}.
            </CardContent>
          </Card>
        )}
        {filtered.map((e) => {
          const prop = state.properties.find((p) => p.id === e.propertyId);
          return (
            <Card key={e.id}>
              <CardContent className="flex flex-wrap items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Wrench className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">{e.itemName}</span>
                    <Badge variant="outline">{e.taxCategory}</Badge>
                    {e.rechargeToTenant && <Badge variant="secondary">Recharged</Badge>}
                    {e.hasWarranty && e.warrantyExpiry && (
                      <Badge variant="outline">Warranty {e.warrantyExpiry}</Badge>
                    )}
                    {e.source === "email_auto" && <Badge variant="secondary">Auto</Badge>}
                    {e.status === "paid" && (
                      <Badge variant="outline">Paid{e.paidDate ? ` ${e.paidDate}` : ""}</Badge>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {e.date} • {prop?.address}
                    {e.invoiceFileName && (
                      <>
                        {" • 📎 "}
                        {e.invoiceFileData ? (
                          <a href={e.invoiceFileData} download={e.invoiceFileName} className="text-primary underline">
                            {e.invoiceFileName}
                          </a>
                        ) : (
                          e.invoiceFileName
                        )}
                      </>
                    )}
                  </div>
                  {e.sourceEmailBody && (
                    <div className="mt-1">
                      <DocumentViewLinks subject={e.sourceSubject} emailBody={e.sourceEmailBody} />
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-right font-medium">{fmtCurrency(e.cost)}</div>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => {
                      deleteExpense(e.id);
                      toast.success("Expense removed");
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
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
        <a
          href={fileData}
          download={fileName || "document.pdf"}
          className="inline-flex items-center gap-1 text-primary underline"
        >
          <FileText className="h-3 w-3" /> View PDF
        </a>
      )}
      {emailBody && (
        <>
          <button
            type="button"
            onClick={() => setShowEmail(true)}
            className="inline-flex items-center gap-1 text-primary underline"
          >
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

function NeedsReviewBanner() {
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
                    {e.source === "email_auto" && <Badge variant="secondary">Auto</Badge>}
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
                    fileName={e.invoiceFileName}
                    fileData={e.invoiceFileData}
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

function ExpenseDialog({
  expense,
  trigger,
}: {
  expense?: Expense;
  trigger?: React.ReactNode;
} = {}) {
  const { state, addExpense, updateExpense, addInvoice } = useStore();
  const [open, setOpen] = useState(false);
  const isEdit = !!expense;
  const [form, setForm] = useState(() =>
    expense
      ? {
          itemName: expense.itemName,
          cost: String(expense.cost),
          date: expense.date,
          propertyId: expense.propertyId ?? state.properties[0]?.id ?? "",
          taxCategory: expense.taxCategory,
          hasWarranty: expense.hasWarranty,
          warrantyExpiry: expense.warrantyExpiry ?? "",
          rechargeToTenant: expense.rechargeToTenant,
          tenantId: expense.tenantId ?? "",
          invoiceFileName: expense.invoiceFileName ?? "",
          invoiceFileData: expense.invoiceFileData ?? "",
        }
      : {
          itemName: "",
          cost: "",
          date: todayISO(),
          propertyId: state.properties[0]?.id ?? "",
          taxCategory: "Immediate Deduction" as Expense["taxCategory"],
          hasWarranty: false,
          warrantyExpiry: "",
          rechargeToTenant: false,
          tenantId: "",
          invoiceFileName: "",
          invoiceFileData: "",
        },
  );

  const handleFile = (f: File | undefined) => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      setForm((s) => ({ ...s, invoiceFileName: f.name, invoiceFileData: String(reader.result) }));
    };
    reader.readAsDataURL(f);
  };

  const submit = () => {
    if (!form.itemName || !form.propertyId) return toast.error("Item and property required");
    const cost = parseFloat(form.cost) || 0;
    const payload = {
      itemName: form.itemName,
      cost,
      date: form.date,
      propertyId: form.propertyId,
      taxCategory: form.taxCategory,
      hasWarranty: form.hasWarranty,
      warrantyExpiry: form.hasWarranty ? form.warrantyExpiry : undefined,
      rechargeToTenant: form.rechargeToTenant,
      tenantId: form.rechargeToTenant ? form.tenantId : undefined,
      invoiceFileName: form.invoiceFileName || undefined,
      invoiceFileData: form.invoiceFileData || undefined,
    };

    if (isEdit && expense) {
      updateExpense(expense.id, payload);
      toast.success("Expense updated");
      setOpen(false);
      return;
    }

    addExpense({ ...payload, status: "approved", source: "manual" });
    if (form.rechargeToTenant && form.tenantId) {
      addInvoice({
        tenantId: form.tenantId,
        chargeType: "Other",
        amountDue: cost,
        dateIssued: form.date,
        dueDate: new Date(new Date(form.date).getTime() + 14 * 86400000).toISOString().slice(0, 10),
        status: "Unpaid",
        description: form.itemName,
      });
      toast.success("Expense logged and recharged to tenant");
    } else {
      toast.success("Expense logged");
    }
    setOpen(false);
    setForm({
      itemName: "",
      cost: "",
      date: todayISO(),
      propertyId: state.properties[0]?.id ?? "",
      taxCategory: "Immediate Deduction",
      hasWarranty: false,
      warrantyExpiry: "",
      rechargeToTenant: false,
      tenantId: "",
      invoiceFileName: "",
      invoiceFileData: "",
    });
  };

  const tenantsForProp = state.tenants.filter((t) => t.propertyId === form.propertyId);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button className="gap-2">
            <Plus className="h-4 w-4" /> Log Expense
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit expense" : "New expense / maintenance"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Item">
            <Input value={form.itemName} onChange={(e) => setForm({ ...form, itemName: e.target.value })} />
          </Field>
          <Field label="Cost (AUD)">
            <Input type="number" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
          </Field>
          <Field label="Date">
            <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </Field>
          <Field label="Property">
            <Select value={form.propertyId} onValueChange={(v) => setForm({ ...form, propertyId: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {state.properties.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.address}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="ATO Tax Category">
            <Select
              value={form.taxCategory}
              onValueChange={(v) => setForm({ ...form, taxCategory: v as Expense["taxCategory"] })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Immediate Deduction">Immediate Deduction</SelectItem>
                <SelectItem value="Capital Works">Capital Works</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Invoice attachment">
            <Input type="file" onChange={(e) => handleFile(e.target.files?.[0])} />
          </Field>
          <div className="col-span-full flex items-center justify-between rounded border p-3">
            <div>
              <div className="text-sm font-medium">Has warranty?</div>
              <div className="text-xs text-muted-foreground">Track expiry for insurance claims.</div>
            </div>
            <Switch checked={form.hasWarranty} onCheckedChange={(v) => setForm({ ...form, hasWarranty: v })} />
          </div>
          {form.hasWarranty && (
            <Field label="Warranty expiry">
              <Input
                type="date"
                value={form.warrantyExpiry}
                onChange={(e) => setForm({ ...form, warrantyExpiry: e.target.value })}
              />
            </Field>
          )}
          <div className="col-span-full flex items-center justify-between rounded border p-3">
            <div>
              <div className="text-sm font-medium">Recharge to tenant?</div>
              <div className="text-xs text-muted-foreground">
                Auto-generates a tenant invoice for this amount.
              </div>
            </div>
            <Switch
              checked={form.rechargeToTenant}
              onCheckedChange={(v) => setForm({ ...form, rechargeToTenant: v })}
            />
          </div>
          {form.rechargeToTenant && (
            <Field label="Tenant">
              <Select value={form.tenantId} onValueChange={(v) => setForm({ ...form, tenantId: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select tenant" />
                </SelectTrigger>
                <SelectContent>
                  {tenantsForProp.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
        </div>
        <DialogFooter>
          <Button onClick={submit}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EofyReport() {
  const { state } = useStore();
  const currentFY = ausFinancialYear(todayISO());
  const [propertyId, setPropertyId] = useState(state.properties[0]?.id ?? "");
  const [fy, setFy] = useState(currentFY);
  const [report, setReport] = useState<null | {
    gross: number;
    byCategory: Record<string, number>;
    interest: number;
    total: number;
    net: number;
    property: string;
  }>(null);

  const generate = () => {
    const prop = state.properties.find((p) => p.id === propertyId);
    if (!prop) return toast.error("Select a property");
    const { start, end } = fyRange(fy);
    const tenants = state.tenants.filter((t) => t.propertyId === propertyId);
    const tenantIds = tenants.map((t) => t.id);
    const gross = state.ledger
      .filter((e) => tenantIds.includes(e.tenantId) && e.date >= start && e.date <= end && e.type === "Rent Payment")
      .reduce((s, e) => s + e.credit, 0);
    const expenses = state.expenses.filter(
      (e) => e.propertyId === propertyId && e.date >= start && e.date <= end,
    );
    const byCategory: Record<string, number> = {};
    for (const e of expenses) {
      byCategory[e.taxCategory] = (byCategory[e.taxCategory] ?? 0) + e.cost;
    }
    const totalExp = expenses.reduce((s, e) => s + e.cost, 0);
    const loan = state.loans.find((l) => l.propertyId === propertyId);
    const interest = loan ? (loan.totalBalance * loan.interestRate) / 100 : 0;
    setReport({
      gross,
      byCategory,
      interest,
      total: totalExp,
      net: gross - totalExp - interest,
      property: prop.address,
    });
  };

  const download = () => {
    if (!report) return;
    const lines = [
      "EOFY Tax Summary",
      `Property: ${report.property}`,
      `Financial Year: ${fy}`,
      "",
      `Gross Rent Collected: ${fmtCurrency(report.gross)}`,
      "",
      "Expenses by ATO Category:",
      ...Object.entries(report.byCategory).map(([k, v]) => `  ${k}: ${fmtCurrency(v)}`),
      `Total Expenses: ${fmtCurrency(report.total)}`,
      "",
      `Estimated Loan Interest Paid: ${fmtCurrency(report.interest)}`,
      "",
      `Net Taxable Profit/Loss: ${fmtCurrency(report.net)}`,
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `EOFY-${fy}-${report.property.slice(0, 20)}.txt`;
    a.click();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">EOFY Statement Generator</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Property">
            <Select value={propertyId} onValueChange={setPropertyId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {state.properties.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.address}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Financial year">
            <Select value={fy} onValueChange={setFy}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 5 }).map((_, i) => {
                  const y = new Date().getFullYear() - 2 + i;
                  const v = `${y}-${y + 1}`;
                  return (
                    <SelectItem key={v} value={v}>
                      FY {v}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </Field>
          <div className="flex items-end">
            <Button onClick={generate}>Generate</Button>
          </div>
        </div>

        {report && (
          <div className="space-y-3 rounded-lg border bg-muted/30 p-4 text-sm">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-muted-foreground">Property</div>
                <div className="font-medium">{report.property}</div>
              </div>
              <Button size="sm" variant="outline" className="gap-1" onClick={download}>
                <Download className="h-4 w-4" /> Download PDF
              </Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Stat label="Gross rent collected" value={fmtCurrency(report.gross)} />
              <Stat label="Total expenses" value={fmtCurrency(report.total)} />
              <Stat label="Loan interest (est.)" value={fmtCurrency(report.interest)} />
              <Stat
                label="Net taxable profit / loss"
                value={fmtCurrency(report.net)}
                strong
                negative={report.net < 0}
              />
            </div>
            <div>
              <div className="mb-1 text-xs font-medium">Expenses by category</div>
              {Object.entries(report.byCategory).map(([k, v]) => (
                <div key={k} className="flex justify-between border-t py-1">
                  <span>{k}</span>
                  <span>{fmtCurrency(v)}</span>
                </div>
              ))}
              {Object.keys(report.byCategory).length === 0 && (
                <div className="text-xs text-muted-foreground">No expenses in this period.</div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
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

function Stat({
  label,
  value,
  strong,
  negative,
}: {
  label: string;
  value: string;
  strong?: boolean;
  negative?: boolean;
}) {
  return (
    <div className="rounded bg-background p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={
          "mt-1 font-medium " + (strong ? "text-base " : "") + (negative ? "text-destructive" : "")
        }
      >
        {value}
      </div>
    </div>
  );
}
