import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SortableTh, toggleSort, type SortState } from "@/components/SortableTh";
import { CollapsibleGroupSection } from "@/components/CollapsibleGroupSection";
import { bucketBy } from "@/lib/group";
import { fmtCurrency } from "@/lib/calculations";
import { Search } from "lucide-react";

export interface CompiledFeedRow {
  key: string;
  date: string;
  description: string;
  amount: number;
  /** "credit" shows +green (reduces a balance owed / money received); "debit" shows − (a charge
   * / money paid out) — same convention LoanCompiledFeed and BankAccounts already used. */
  direction: "debit" | "credit";
  /** "reference" is LoanCompiledFeed-only (a whole-EMI line that's informational, never
   * recordable) — omit onRecord/onUnrecord for those rows. */
  status: "recorded" | "feed_only" | "reference";
  /** Shown as a tooltip on the "Reference only" badge — why this specific line has no action. */
  statusNote?: string;
  onRecord?: () => void;
  onUnrecord?: () => void;
}

type SortField = "date" | "description" | "amount" | "status";
type GroupBy = "none" | "month";

function formatMonthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  if (!y || !m) return "No date";
  return new Date(y, m - 1, 1).toLocaleDateString("en-AU", { month: "long", year: "numeric" });
}

function sortValue(r: CompiledFeedRow, field: SortField): string | number {
  switch (field) {
    case "date":
      return r.date;
    case "description":
      return r.description.toLowerCase();
    case "amount":
      return r.amount;
    case "status":
      return r.status;
  }
}

function RowActions({ r }: { r: CompiledFeedRow }) {
  if (r.status === "reference") {
    return (
      <Badge variant="outline" className="border-dashed text-muted-foreground" title={r.statusNote}>
        Reference only
      </Badge>
    );
  }
  if (r.status === "recorded") {
    return (
      <div className="flex items-center justify-end gap-2">
        <Badge variant="secondary">Recorded</Badge>
        {r.onUnrecord && (
          <Button size="sm" variant="outline" className="h-6 text-xs" onClick={r.onUnrecord}>
            Unrecord
          </Button>
        )}
      </div>
    );
  }
  return (
    <div className="flex items-center justify-end gap-2">
      <Badge variant="outline">Feed only</Badge>
      {r.onRecord && (
        <Button size="sm" className="h-6 text-xs" onClick={r.onRecord}>
          Record
        </Button>
      )}
    </div>
  );
}

function FeedTableBody({
  rows,
  sort,
  onSort,
}: {
  rows: CompiledFeedRow[];
  sort: SortState<SortField> | null;
  onSort: (f: SortField) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="p-4 text-center text-xs text-muted-foreground">
        No transactions match these filters.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <SortableTh field="date" label="Date" sort={sort} onSort={onSort} />
            <SortableTh field="description" label="Description" sort={sort} onSort={onSort} />
            <SortableTh field="amount" label="Amount" align="right" sort={sort} onSort={onSort} />
            <SortableTh field="status" label="Status" align="right" sort={sort} onSort={onSort} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b last:border-0 hover:bg-muted/30">
              <td className="whitespace-nowrap px-3 py-2">{r.date}</td>
              <td className="max-w-[320px] truncate px-3 py-2" title={r.description}>
                {r.description}
              </td>
              <td
                className={
                  "px-3 py-2 text-right font-medium " +
                  (r.direction === "credit" ? "text-emerald-600" : "")
                }
              >
                {r.direction === "credit" ? "+" : "−"}
                {fmtCurrency(r.amount)}
              </td>
              <td className="px-3 py-2 text-right">
                <RowActions r={r} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Shared table for every "compiled bank feed" (per loan, per bank account, and the unassigned
 * bucket) — same column layout/order (Date, Description, Amount, Status) and the same
 * search/filter/group-by/sort affordances already used across the app's other lists (Bills,
 * Transactions), so a landlord doesn't have to learn a different interaction model per feed.
 */
export function CompiledFeedTable({
  rows,
  includeReferenceFilter,
}: {
  rows: CompiledFeedRow[];
  includeReferenceFilter?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"__all__" | CompiledFeedRow["status"]>("__all__");
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
  const [sort, setSort] = useState<SortState<SortField> | null>(null);

  const filtered = rows
    .filter((r) => status === "__all__" || r.status === status)
    .filter((r) => !query || r.description.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => {
      if (!sort) return a.date < b.date ? 1 : -1;
      const av = sortValue(a, sort.field);
      const bv = sortValue(b, sort.field);
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sort.dir === "asc" ? cmp : -cmp;
    });

  const groups = useMemo(() => {
    if (groupBy === "none") return null;
    const map = bucketBy(filtered, (r) => r.date.slice(0, 7));
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [filtered, groupBy]);

  const handleSort = (f: SortField) => setSort((s) => toggleSort(s, f));
  const recordedCount = rows.filter((r) => r.status === "recorded").length;
  const feedOnlyCount = rows.filter((r) => r.status === "feed_only").length;
  const referenceCount = rows.filter((r) => r.status === "reference").length;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search transactions…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-7 w-[180px] pl-7 text-xs"
          />
        </div>
        <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
          <SelectTrigger className="h-7 w-[160px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All ({rows.length})</SelectItem>
            <SelectItem value="recorded">Recorded ({recordedCount})</SelectItem>
            <SelectItem value="feed_only">Feed only ({feedOnlyCount})</SelectItem>
            {includeReferenceFilter && referenceCount > 0 && (
              <SelectItem value="reference">Reference only ({referenceCount})</SelectItem>
            )}
          </SelectContent>
        </Select>
        <Select value={groupBy} onValueChange={(v) => setGroupBy(v as GroupBy)}>
          <SelectTrigger className="h-7 w-[130px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No grouping</SelectItem>
            <SelectItem value="month">By month</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {groupBy === "none" || !groups ? (
        <FeedTableBody rows={filtered} sort={sort} onSort={handleSort} />
      ) : (
        <div className="space-y-2">
          {groups.length === 0 && (
            <div className="p-4 text-center text-xs text-muted-foreground">
              No transactions match these filters.
            </div>
          )}
          {groups.map(([key, groupRows]) => (
            <CollapsibleGroupSection
              key={key || "no-date"}
              label={formatMonthLabel(key)}
              summary={
                <Badge variant="outline" className="font-normal">
                  {groupRows.length}
                </Badge>
              }
            >
              <FeedTableBody rows={groupRows} sort={sort} onSort={handleSort} />
            </CollapsibleGroupSection>
          ))}
        </div>
      )}
    </div>
  );
}
