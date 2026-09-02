import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, FolderOpen, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DocumentLink } from "@/components/DocumentLink";
import { daysUntil } from "@/lib/calculations";
import { matchesDocumentQuery, type DocumentEntry } from "@/lib/documents";

/**
 * Small reusable "Documents" section for a single property tab (Tenancy, Purchase & Acquisition,
 * Loans, Depreciation, Maintenance) — a lighter-weight row than the full portfolio-wide Documents
 * table (DocTable in documents.tsx), since each of these is always pre-filtered to one property and
 * one or two document kinds. Carries the same search matching and a newest/oldest sort toggle as
 * the full Documents page, just without its FY/group-by/tenant/property filters — those don't make
 * sense pinned inside one property's one tab.
 */
export function DocumentsSection({
  title,
  entries,
  searchPlaceholder = "Search documents…",
  emptyMessage = "No documents on file yet.",
}: {
  title: string;
  entries: DocumentEntry[];
  searchPlaceholder?: string;
  emptyMessage?: string;
}) {
  const [query, setQuery] = useState("");
  const [sortDir, setSortDir] = useState<"newest" | "oldest">("newest");

  const rows = useMemo(() => {
    const filtered = entries.filter((d) => matchesDocumentQuery(d, query));
    return [...filtered].sort((a, b) =>
      sortDir === "newest" ? (a.date < b.date ? 1 : -1) : a.date < b.date ? -1 : 1,
    );
  }, [entries, query, sortDir]);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium">
          {title} ({entries.length})
        </div>
        {entries.length > 0 && (
          <div className="flex items-center gap-1">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={searchPlaceholder}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-8 w-[160px] pl-7 text-xs"
              />
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8 shrink-0"
              title={sortDir === "newest" ? "Newest first" : "Oldest first"}
              onClick={() => setSortDir((d) => (d === "newest" ? "oldest" : "newest"))}
            >
              {sortDir === "newest" ? <ArrowDown className="h-3.5 w-3.5" /> : <ArrowUp className="h-3.5 w-3.5" />}
            </Button>
          </div>
        )}
      </div>
      {entries.length === 0 ? (
        <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
          <FolderOpen className="mx-auto mb-1 h-4 w-4" />
          {emptyMessage}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
          No documents match your search.
        </div>
      ) : (
        <div className="space-y-1">
          {rows.map((d) => {
            const expiring = d.warrantyExpiry ? daysUntil(d.warrantyExpiry) : undefined;
            return (
              <div key={`${d.kind}-${d.id}`} className="flex items-center justify-between gap-2 rounded border p-2 text-xs">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate font-medium">{d.label}</span>
                    {expiring !== undefined && (
                      <Badge variant={expiring < 0 ? "destructive" : "outline"} className="text-[10px]">
                        {expiring < 0 ? "Expired" : `Expires in ${expiring}d`}
                      </Badge>
                    )}
                  </div>
                  <div className="text-muted-foreground">{d.period ?? d.date ?? "—"}</div>
                </div>
                {d.fileData ? (
                  <DocumentLink fileName={d.fileName} fileData={d.fileData} className="shrink-0 text-primary underline">
                    {d.fileName ?? "View"}
                  </DocumentLink>
                ) : (
                  <span className="shrink-0 text-muted-foreground">No file</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
