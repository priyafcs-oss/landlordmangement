import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useStore } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BillRow } from "@/components/BillRow";
import { Receipt } from "lucide-react";
import { fmtCurrency, todayISO } from "@/lib/calculations";
import type { BillType } from "@/lib/types";
import { toast } from "sonner";

export const Route = createFileRoute("/bills")({
  head: () => ({
    meta: [
      { title: "Bills — Landlord OS" },
      { name: "description", content: "Every outstanding bill across the portfolio, in one place." },
    ],
  }),
  component: BillsPage,
});

const STATUS_OPTIONS = ["__all__", "Unpaid", "Overdue", "Paid"] as const;
const BILL_TYPES: BillType[] = ["Water", "Council Rates", "Strata", "Insurance", "Electricity", "Gas", "Other"];

function BillsPage() {
  const { state, markBillPaid, deleteBill } = useStore();
  const [propertyId, setPropertyId] = useState("__all__");
  const [status, setStatus] = useState<(typeof STATUS_OPTIONS)[number]>("__all__");
  const [billType, setBillType] = useState<"__all__" | BillType>("__all__");

  const today = todayISO();
  const isOverdue = (b: (typeof state.bills)[number]) => b.status === "Unpaid" && b.dueDate < today;

  const filtered = state.bills
    .filter((b) => propertyId === "__all__" || b.propertyId === propertyId)
    .filter((b) => billType === "__all__" || b.billType === billType)
    .filter((b) => {
      if (status === "__all__") return true;
      if (status === "Overdue") return isOverdue(b);
      if (status === "Unpaid") return b.status === "Unpaid" && !isOverdue(b);
      return b.status === "Paid";
    })
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));

  const outstanding = state.bills.filter((b) => b.status !== "Paid");
  const outstandingTotal = outstanding.reduce((s, b) => s + b.amount, 0);
  const byType = outstanding.reduce<Record<string, number>>((acc, b) => {
    acc[b.billType] = (acc[b.billType] ?? 0) + b.amount;
    return acc;
  }, {});

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Bills</h1>
        <p className="text-sm text-muted-foreground">Every bill across the portfolio — nothing slides quietly.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={propertyId} onValueChange={setPropertyId}>
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
            <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All statuses</SelectItem>
                <SelectItem value="Unpaid">Unpaid</SelectItem>
                <SelectItem value="Overdue">Overdue</SelectItem>
                <SelectItem value="Paid">Paid</SelectItem>
              </SelectContent>
            </Select>
            <Select value={billType} onValueChange={(v) => setBillType(v as typeof billType)}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All types</SelectItem>
                {BILL_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            {filtered.length === 0 && (
              <Card>
                <CardContent className="p-6 text-center text-sm text-muted-foreground">
                  <Receipt className="mx-auto mb-2 h-6 w-6" />
                  No bills match these filters.
                </CardContent>
              </Card>
            )}
            {filtered.map((b) => {
              const prop = state.properties.find((p) => p.id === b.propertyId);
              return (
                <BillRow
                  key={b.id}
                  bill={b}
                  propertyLabel={prop?.alias || prop?.address}
                  onPaid={() => {
                    markBillPaid(b.id);
                    toast.success("Marked paid" + (b.recurrenceMonths ? " — next cycle scheduled" : ""));
                  }}
                  onDelete={() => {
                    if (confirm(`Delete this ${b.billType} bill?`)) {
                      deleteBill(b.id);
                      toast.success("Bill removed");
                    }
                  }}
                />
              );
            })}
          </div>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Outstanding</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold tracking-tight">{fmtCurrency(outstandingTotal)}</div>
              <div className="text-xs text-muted-foreground">
                across {outstanding.length} bill{outstanding.length === 1 ? "" : "s"}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">By type</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {Object.keys(byType).length === 0 && <div className="text-xs text-muted-foreground">Nothing outstanding.</div>}
              {Object.entries(byType)
                .sort((a, b) => b[1] - a[1])
                .map(([type, amount]) => (
                  <div key={type} className="flex items-center justify-between">
                    <span className="text-muted-foreground">{type}</span>
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
