import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/Field";
import { newInstalmentRow, type InstalmentRow } from "@/lib/instalments";

/**
 * The one payment-schedule editor — a new bill's "Payment plan" (AddBillDialog) and a saved bill's
 * "Edit schedule" (BillDetailDialog) both render this. `numberOffset` is how many instalments come
 * before these rows (1 for a new bill, whose first instalment is the bill itself).
 */
export function InstalmentScheduleEditor({
  rows,
  onChange,
  onRemove,
  numberOffset = 0,
  addLabel = "Add instalment",
}: {
  rows: InstalmentRow[];
  onChange: (rows: InstalmentRow[]) => void;
  /** Called instead of dropping the row straight away, e.g. to refuse removing the last one. */
  onRemove?: (row: InstalmentRow) => void;
  numberOffset?: number;
  addLabel?: string;
}) {
  const update = (key: string, patch: Partial<InstalmentRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.key} className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2">
          <Field label="Label">
            <Input value={row.label} onChange={(e) => update(row.key, { label: e.target.value })} />
          </Field>
          <Field label="Due date">
            <Input
              type="date"
              value={row.dueDate}
              onChange={(e) => update(row.key, { dueDate: e.target.value })}
            />
          </Field>
          <Field label="Amount">
            <Input
              type="number"
              step="0.01"
              value={row.amount}
              onChange={(e) => update(row.key, { amount: e.target.value })}
            />
          </Field>
          <Button
            size="icon"
            variant="ghost"
            onClick={() =>
              onRemove ? onRemove(row) : onChange(rows.filter((r) => r.key !== row.key))
            }
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button
        size="sm"
        variant="outline"
        className="gap-1"
        onClick={() => onChange([...rows, newInstalmentRow(numberOffset + rows.length + 1)])}
      >
        <Plus className="h-3 w-3" /> {addLabel}
      </Button>
    </div>
  );
}
