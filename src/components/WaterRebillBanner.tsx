import { useStore } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Droplets, Pencil, X } from "lucide-react";
import { fmtCurrency } from "@/lib/calculations";
import { toast } from "sonner";
import { BillDetailDialog } from "@/components/BillDetailDialog";

/** Water bills auto-approve straight to Bills now instead of being forced into review — this is
 * where the recharge-to-tenant decision that used to gate that review surfaces instead, as a
 * non-blocking follow-up rather than something that had to be resolved before the bill even
 * posted. Clears once the landlord opens the bill (BillDetailDialog's saveDetails) or explicitly
 * says no recharge is needed here. */
export function WaterRebillBanner() {
  const { state, updateBill } = useStore();
  const pending = state.bills.filter((b) => b.tenantRebillStatus === "pending");
  if (pending.length === 0) return null;

  return (
    <Card className="border-sky-500/50 bg-sky-500/5">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Droplets className="h-4 w-4 text-sky-600" />
          Water bills — recharge to tenant? ({pending.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {pending.map((b) => {
          const property = state.properties.find((p) => p.id === b.propertyId);
          return (
            <Card key={b.id} className="border-sky-500/30">
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="min-w-0 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">Water</Badge>
                    <span className="font-medium">{b.providerName || "Water bill"}</span>
                    <span className="text-xs text-muted-foreground">{fmtCurrency(b.amount)} • due {b.dueDate}</span>
                  </div>
                  {property && <div className="text-xs text-muted-foreground">{property.alias || property.address}</div>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <BillDetailDialog
                    bill={b}
                    propertyLabel={property?.alias || property?.address}
                    trigger={
                      <Button size="sm" variant="outline" className="gap-1">
                        <Pencil className="h-3 w-3" /> Review
                      </Button>
                    }
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1"
                    onClick={() => {
                      updateBill(b.id, { tenantRebillStatus: "resolved" });
                      toast.success("No recharge needed — noted");
                    }}
                  >
                    <X className="h-3 w-3" /> No recharge needed
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
