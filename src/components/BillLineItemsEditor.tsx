import { Plus, Trash2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/Field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RechargeControl } from "@/components/RechargeControl";
import { WaterSplitPanel } from "@/components/WaterSplitPanel";
import { fmtCurrency } from "@/lib/calculations";
import { BILL_TYPES } from "@/lib/constants";
import { blankBillLine, type BillLineRow } from "@/lib/billLines";
import {
  canRechargeLine,
  lastFixedWaterCharge,
  needsWaterSplit,
  rechargeBlockedReason,
} from "@/lib/waterSplit";
import type { BillType, Tenant } from "@/lib/types";

/**
 * The one line-items editor for bills — the first-time review (AddBillDialog) and a saved bill
 * (BillDetailDialog) both render this, so recharge, Email tenant, the usage-only water rule and
 * the water split behave identically in both. Fix or extend it here, not in a dialog.
 */
export function BillLineItemsEditor({
  rows,
  onChange,
  billType,
  tenants,
  propertyId,
  excludeBillId,
  hasDocument,
  onEmailTenant,
}: {
  rows: BillLineRow[];
  onChange: (rows: BillLineRow[]) => void;
  billType: BillType;
  tenants: Tenant[];
  propertyId: string;
  /** A saved bill's own id, so its own lines don't count as "the last itemised bill". */
  excludeBillId?: string;
  hasDocument: boolean;
  onEmailTenant: (row: BillLineRow) => void;
}) {
  const { state } = useStore();
  const netTotal = rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
  const update = (key: string, patch: Partial<BillLineRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const soleTenantId = tenants.length === 1 ? tenants[0].id : "";

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium">Line items</div>
        <div className="text-xs text-muted-foreground">Net: {fmtCurrency(netTotal)}</div>
      </div>
      {rows.map((li) => (
        <div key={li.key} className="space-y-1 border-b pb-2 last:border-0 last:pb-0">
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] items-end gap-2">
            <Field label="Description">
              <Input
                value={li.description}
                onChange={(e) => update(li.key, { description: e.target.value })}
              />
            </Field>
            <Field label="Category">
              <Select
                value={li.category}
                onValueChange={(v) => update(li.key, { category: v as BillType })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BILL_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Amount">
              <Input
                type="number"
                step="0.01"
                value={li.amount}
                onChange={(e) => update(li.key, { amount: e.target.value })}
              />
            </Field>
            <Field label="GST">
              <Input
                type="number"
                step="0.01"
                value={li.gst}
                onChange={(e) => update(li.key, { gst: e.target.value })}
              />
            </Field>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => onChange(rows.filter((r) => r.key !== li.key))}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <RechargeControl
            checked={li.rechargeToTenant}
            tenantId={li.tenantId}
            tenants={tenants}
            recharged={li.recharged}
            canRecharge={canRechargeLine(billType, li.category, li.description)}
            blockedReason={rechargeBlockedReason(billType, li.category, li.description)}
            onChange={(next) => update(li.key, next)}
            onEmail={() => onEmailTenant(li)}
          />
        </div>
      ))}
      {needsWaterSplit(billType, rows) && !rows.some((r) => r.recharged) && (
        <WaterSplitPanel
          total={netTotal}
          lastFixed={lastFixedWaterCharge(
            state.bills.filter((b) => b.id !== excludeBillId),
            propertyId,
          )}
          hasDocument={hasDocument}
          onSplit={(lines) =>
            onChange(
              lines.map((l) =>
                blankBillLine("Water", {
                  description: l.description,
                  amount: l.amount.toFixed(2),
                  tenantId: l.kind === "usage" ? soleTenantId : "",
                }),
              ),
            )
          }
        />
      )}
      <Button
        size="sm"
        variant="outline"
        className="gap-1"
        onClick={() => onChange([...rows, blankBillLine(billType)])}
      >
        <Plus className="h-3 w-3" /> Add line item
      </Button>
    </div>
  );
}
