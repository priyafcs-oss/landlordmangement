import { useState, type ReactNode } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ChevronUp } from "lucide-react";

/** One collapsible "group" row in a grouped list (Bills by category/provider, Transactions by
 * month/FY/provider, Documents by month/FY) — a header with a chevron/label/summary that expands
 * to reveal the group's own table. `summary` is deliberately free-form since each list wants a
 * different right-aligned line (a count badge, an income/expense split, a running total). */
export function CollapsibleGroupSection({ label, summary, children }: { label: string; summary: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded border">
      <CollapsibleTrigger asChild>
        <button type="button" className="flex w-full items-center justify-between gap-2 p-3 text-left text-sm">
          <span className="flex items-center gap-2 font-medium">
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            {label}
          </span>
          <span className="flex items-center gap-3 text-xs text-muted-foreground">{summary}</span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t">{children}</CollapsibleContent>
    </Collapsible>
  );
}
