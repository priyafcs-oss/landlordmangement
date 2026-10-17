import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Tenant } from "@/lib/types";

/**
 * The one "Recharge to tenant" control for every bill line and expense line. Shows:
 * - "Recharged to X" (locked) once an invoice has gone out, with Email tenant still available;
 * - a fixed-charge note where the line can't be recharged (a water bill's service charges);
 * - otherwise the checkbox + tenant picker, pre-picking the tenant when the property has only one,
 *   and Email tenant as soon as a tenant is picked (when the caller can email).
 */
export function RechargeControl({
  checked,
  tenantId,
  tenants,
  canRecharge,
  blockedReason,
  recharged,
  onChange,
  onEmail,
}: {
  checked: boolean;
  tenantId: string;
  tenants: Tenant[];
  canRecharge: boolean;
  /** Shown instead of the checkbox when canRecharge is false; omit to show nothing. */
  blockedReason?: string;
  recharged?: boolean;
  onChange: (next: { rechargeToTenant: boolean; tenantId: string }) => void;
  onEmail?: () => void;
}) {
  const tenantName = tenants.find((t) => t.id === tenantId)?.name;
  const emailButton = onEmail && tenantId && (
    <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={onEmail}>
      <Mail className="h-3 w-3" /> Email tenant
    </Button>
  );

  if (recharged) {
    return (
      <div className="flex items-center gap-2 text-xs text-emerald-700">
        Recharged to {tenantName ?? "tenant"}
        {emailButton}
      </div>
    );
  }
  if (!canRecharge) {
    return blockedReason ? (
      <div className="text-xs text-muted-foreground">{blockedReason}</div>
    ) : null;
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Checkbox
        checked={checked}
        onCheckedChange={(v) =>
          onChange({
            rechargeToTenant: v === true,
            tenantId: tenantId || (tenants.length === 1 ? tenants[0].id : ""),
          })
        }
      />
      <Label className="cursor-pointer text-xs font-normal text-muted-foreground">
        Recharge to tenant
      </Label>
      {checked && (
        <Select
          value={tenantId}
          onValueChange={(v) => onChange({ rechargeToTenant: true, tenantId: v })}
        >
          <SelectTrigger className="h-7 w-[160px] text-xs">
            <SelectValue placeholder="Select tenant" />
          </SelectTrigger>
          <SelectContent>
            {tenants.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {checked && emailButton}
    </div>
  );
}
