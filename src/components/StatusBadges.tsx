import { Badge } from "@/components/ui/badge";
import { isBillOverdue } from "@/lib/calculations";
import type { PropertyBill } from "@/lib/types";

/** "3 days" / "2 days overdue" (or "3d" / "2d overdue" compact) — one wording for every due-date
 * countdown (the Dashboard and Overview each used their own). */
export function DueInBadge({
  days,
  compact = false,
  className,
}: {
  days: number;
  compact?: boolean;
  className?: string;
}) {
  const unit = compact ? "d" : days === 1 || days === -1 ? " day" : " days";
  return (
    <Badge variant={days < 0 ? "destructive" : "outline"} className={className}>
      {days < 0 ? `${Math.abs(days)}${unit} overdue` : `${days}${unit}`}
    </Badge>
  );
}

/** A bill's status — "Overdue" (red) when it's past due and still owes money (part-paid
 * included), otherwise its stored status. */
export function BillStatusBadge({ bill, className }: { bill: PropertyBill; className?: string }) {
  const overdue = isBillOverdue(bill);
  return (
    <Badge
      variant={bill.status === "Paid" ? "secondary" : overdue ? "destructive" : "outline"}
      className={className}
    >
      {overdue ? "Overdue" : bill.status}
    </Badge>
  );
}
