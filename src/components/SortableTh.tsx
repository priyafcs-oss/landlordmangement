import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";

export type SortDir = "asc" | "desc";
export interface SortState<T extends string> {
  field: T;
  dir: SortDir;
}

/** Clicking the same field again flips direction; clicking a new field starts it ascending. Shared
 * by BillsBoard and Transactions' TxTable so both tables' column headers behave identically. */
export function toggleSort<T extends string>(current: SortState<T> | null, field: T): SortState<T> {
  if (current?.field === field) return { field, dir: current.dir === "asc" ? "desc" : "asc" };
  return { field, dir: "asc" };
}

/** A clickable `<th>` that sorts a table by `field` — the one header cell shared between the Bills
 * and Transactions tables so "click a column to sort/group by it" behaves and looks the same in
 * both places. */
export function SortableTh<T extends string>({
  field,
  label,
  align = "left",
  sort,
  onSort,
  className,
}: {
  field: T;
  label: string;
  align?: "left" | "right";
  sort: SortState<T> | null;
  onSort: (field: T) => void;
  className?: string;
}) {
  const active = sort?.field === field;
  return (
    <th className={`px-3 py-2 font-medium ${align === "right" ? "text-right" : "text-left"} ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className={`inline-flex items-center gap-1 hover:text-foreground ${active ? "text-foreground" : ""} ${align === "right" ? "flex-row-reverse" : ""}`}
      >
        <span>{label}</span>
        {active ? (
          sort.dir === "asc" ? (
            <ArrowUp className="h-3 w-3 shrink-0" />
          ) : (
            <ArrowDown className="h-3 w-3 shrink-0" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 shrink-0 opacity-30" />
        )}
      </button>
    </th>
  );
}
