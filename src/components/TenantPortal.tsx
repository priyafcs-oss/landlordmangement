import { useStore } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buildTenantLedger, fmtCurrency, addDays } from "@/lib/calculations";
import { Home, Calendar, Receipt, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export function TenantPortal({ tenantId }: { tenantId: string }) {
  const { state } = useStore();
  const tenant = state.tenants.find((t) => t.id === tenantId);
  if (!tenant) return <div className="p-6">Tenant not found.</div>;
  const property = state.properties.find((p) => p.id === tenant.propertyId);
  const { total, rows, outstandingInvoices } = buildTenantLedger(tenant, state.ledger, state.invoices, state.rentChanges);
  const unpaidInvoices = state.invoices.filter((i) => i.tenantId === tenantId && i.status === "Unpaid");
  const receipts = rows.filter((r) => r.credit > 0);

  return (
    <div className="mx-auto max-w-md space-y-4 bg-muted/30 p-4 min-h-[calc(100vh-3.5rem)]">
      <Card className="overflow-hidden">
        <div className="bg-primary p-5 text-primary-foreground">
          <div className="flex items-center gap-2 text-sm opacity-80">
            <Home className="h-4 w-4" />
            Your rental
          </div>
          <div className="mt-1 text-lg font-semibold">{tenant.unitAddress || property?.address}</div>
        </div>
        <CardContent className="grid grid-cols-2 gap-4 p-5 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">Rent</div>
            <div className="font-medium">
              {fmtCurrency(tenant.rentAmount)} <span className="text-xs text-muted-foreground">/ {tenant.rentFrequency}</span>
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Next rent due</div>
            <div className="font-medium">{addDays(tenant.paidUpToDate, 1)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Lease expires</div>
            <div className="font-medium">{tenant.leaseExpiry || "Periodic"}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Reference</div>
            <div className="font-medium">{tenant.bankReference || "—"}</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            <span>Account balance</span>
            <Badge variant={total > 0 ? "destructive" : "secondary"}>
              {total > 0 ? "In arrears" : "Up to date"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-semibold">{fmtCurrency(Math.max(0, total))}</div>
          <div className="text-xs text-muted-foreground">Owing across rent + invoices</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Receipt className="h-4 w-4" /> Outstanding invoices
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {unpaidInvoices.length === 0 && <div className="text-muted-foreground">No outstanding invoices.</div>}
          {unpaidInvoices.map((i) => (
            <div key={i.id} className="flex items-start justify-between rounded border p-3">
              <div>
                <div className="font-medium">{i.chargeType}</div>
                <div className="text-xs text-muted-foreground">Due {i.dueDate}</div>
              </div>
              <div className="text-right font-medium">{fmtCurrency(i.amountDue)}</div>
            </div>
          ))}
          {unpaidInvoices.length > 0 && (
            <div className="rounded bg-muted p-3 text-xs">
              <div className="font-medium">How to pay</div>
              <div className="mt-1 text-muted-foreground">
                Bank transfer using reference <b>{tenant.bankReference || "—"}</b>. Contact your landlord for full account
                details.
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Calendar className="h-4 w-4" /> Payment history
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {receipts.length === 0 && <div className="text-muted-foreground">No payments recorded yet.</div>}
          {receipts.map((r) => (
            <div key={r.id} className="flex items-center justify-between rounded border p-3">
              <div className="min-w-0">
                <div className="truncate font-medium">{r.description}</div>
                <div className="text-xs text-muted-foreground">{r.date}</div>
              </div>
              <div className="flex items-center gap-2">
                <div className="font-medium">{fmtCurrency(r.credit)}</div>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => toast.success("Receipt PDF downloaded (simulated)")}
                >
                  <Download className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="text-center text-xs text-muted-foreground">
        Outstanding invoices: {fmtCurrency(outstandingInvoices)}
      </div>
    </div>
  );
}
