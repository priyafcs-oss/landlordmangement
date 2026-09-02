import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, FileText, FolderOpen, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DocumentLink } from "@/components/DocumentLink";
import { useStore } from "@/lib/store";
import { daysUntil, fmtCurrency, ausFinancialYear, fyRange, buildFyOptions } from "@/lib/calculations";
import { bucketBy } from "@/lib/group";
import { matchesDocumentQuery, type DocumentEntry } from "@/lib/documents";

/**
 * Small reusable "Documents" section for a single property tab (Tenancy, Purchase & Acquisition,
 * Loans, Depreciation, Maintenance) — a lighter-weight row than the full portfolio-wide Documents
 * table (DocTable below), since each of these is always pre-filtered to one property and
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

export type FileFormat = "PDF" | "Image" | "Spreadsheet" | "Document" | "Email / web" | "Other";
export const FILE_FORMATS: FileFormat[] = ["PDF", "Image", "Spreadsheet", "Document", "Email / web", "Other"];

/** File format is inferred from the extension since nothing stores it explicitly — falls back to
 * "Email / web" for an entry that only ever carried the source email (no attachment), and "Other"
 * for an unrecognised extension that still has an actual file attached. */
export function fileFormatOf(d: Pick<DocumentEntry, "fileName" | "fileData" | "emailBody">): FileFormat | undefined {
  if (d.fileData) {
    const ext = d.fileName?.split(".").pop()?.toLowerCase() ?? "";
    if (ext === "pdf") return "PDF";
    if (["png", "jpg", "jpeg", "gif", "webp", "heic"].includes(ext)) return "Image";
    if (["xls", "xlsx", "csv"].includes(ext)) return "Spreadsheet";
    if (["doc", "docx"].includes(ext)) return "Document";
    return "Other";
  }
  if (d.emailBody) return "Email / web";
  return undefined;
}

/** Rough size from the base64 payload — nothing stores an actual byte count. */
export function estimateFileSize(dataUrl?: string): string {
  if (!dataUrl) return "—";
  const base64 = dataUrl.includes(",") ? dataUrl.slice(dataUrl.indexOf(",") + 1) : dataUrl;
  const bytes = (base64.length * 3) / 4;
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDocMonthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-AU", { month: "long", year: "numeric" });
}

export function DocTable({ rows, showProperty = true }: { rows: DocumentEntry[]; showProperty?: boolean }) {
  const { state } = useStore();
  if (rows.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        <FolderOpen className="mx-auto mb-2 h-6 w-6" />
        No documents in this period.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="px-3 py-2 font-medium">Name</th>
            <th className="px-3 py-2 font-medium">Type</th>
            <th className="px-3 py-2 font-medium">Period</th>
            <th className="px-3 py-2 font-medium">Date added</th>
            <th className="px-3 py-2 font-medium">Size</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => {
            const property = state.properties.find((p) => p.id === d.propertyId);
            return (
              <tr key={`${d.kind}-${d.id}`} className="border-b last:border-0 hover:bg-muted/30">
                <td className="px-3 py-2">
                  <DocumentNameCell d={d} showProperty={showProperty} property={property} />
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{d.kind}</td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">{d.period ?? d.date ?? "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">{d.dateAdded?.slice(0, 10) ?? "—"}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{estimateFileSize(d.fileData)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function DocGroupSection({ label, rows, showProperty }: { label: string; rows: DocumentEntry[]; showProperty?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded border">
      <CollapsibleTrigger asChild>
        <button type="button" className="flex w-full items-center justify-between gap-2 p-3 text-left text-sm">
          <span className="flex items-center gap-2 font-medium">
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            {label}
          </span>
          <Badge variant="outline" className="font-normal">
            {rows.length} document{rows.length === 1 ? "" : "s"}
          </Badge>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t">
        <DocTable rows={rows} showProperty={showProperty} />
      </CollapsibleContent>
    </Collapsible>
  );
}

export function DocumentNameCell({
  d,
  showProperty,
  property,
}: {
  d: DocumentEntry;
  showProperty: boolean;
  property?: { alias?: string; address: string };
}) {
  const [showEmail, setShowEmail] = useState(false);
  const primaryName = d.fileName || d.label;
  const showLabelSubtitle = !!d.fileName && !!d.label && d.label !== d.fileName;

  const inner = (
    <div className="flex items-center gap-2">
      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5 font-medium">
          <span className="truncate">{primaryName}</span>
          {d.amount !== undefined && <span className="font-normal text-muted-foreground">{fmtCurrency(d.amount)}</span>}
          {d.status && (
            <Badge variant="secondary" className="font-normal">
              {d.status}
            </Badge>
          )}
        </div>
        {showLabelSubtitle && <div className="truncate text-xs text-muted-foreground">{d.label}</div>}
        {showProperty && property && (
          <div className="truncate text-xs text-muted-foreground">{property.alias || property.address}</div>
        )}
      </div>
    </div>
  );

  if (d.fileData) {
    return (
      <DocumentLink fileName={d.fileName} fileData={d.fileData} className="inline-flex items-center hover:underline">
        {inner}
      </DocumentLink>
    );
  }
  if (d.emailBody) {
    return (
      <>
        <button type="button" onClick={() => setShowEmail(true)} className="inline-flex items-center text-left hover:underline">
          {inner}
        </button>
        <Dialog open={showEmail} onOpenChange={setShowEmail}>
          <DialogContent className="max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{d.subject || "Email"}</DialogTitle>
            </DialogHeader>
            <pre className="whitespace-pre-wrap text-xs">{d.emailBody}</pre>
          </DialogContent>
        </Dialog>
      </>
    );
  }
  return inner;
}

/**
 * Search/type/file-format/FY/group-by/tenant filter state + the resulting filtered & grouped
 * list — the logic shared by DocumentsPanel below and the standalone "Other documents" page
 * (routes/documents.tsx), which wraps this same filtering in its own richer page shell (tabs, an
 * Insights sidebar, a property picker) that doesn't belong on every embedded per-tab list.
 */
export function useDocumentFilters(entries: DocumentEntry[]) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"__all__" | DocumentEntry["kind"]>("__all__");
  const [fileFormat, setFileFormat] = useState<"__all__" | FileFormat>("__all__");
  const [fy, setFy] = useState("all");
  const [groupBy, setGroupBy] = useState<"none" | "month" | "fy">("none");
  const [tenantId, setTenantId] = useState("__all__");
  const [sortDir, setSortDir] = useState<"newest" | "oldest">("newest");

  const fys = useMemo(() => buildFyOptions(), []);
  const { start, end } = fy === "all" ? { start: "", end: "" } : fyRange(fy);

  const filtered = useMemo(
    () =>
      entries
        .filter((d) => matchesDocumentQuery(d, query))
        .filter((d) => kind === "__all__" || d.kind === kind)
        .filter((d) => fileFormat === "__all__" || fileFormatOf(d) === fileFormat)
        .filter((d) => tenantId === "__all__" || d.tenantId === tenantId)
        .filter((d) => fy === "all" || (d.date >= start && d.date <= end))
        .sort((a, b) => (sortDir === "newest" ? (a.date < b.date ? 1 : -1) : a.date < b.date ? -1 : 1)),
    [entries, query, kind, fileFormat, tenantId, fy, start, end, sortDir],
  );

  const groups = useMemo(() => {
    if (groupBy === "none") return null;
    const map = bucketBy(filtered, (d) => (!d.date ? "unknown" : groupBy === "month" ? d.date.slice(0, 7) : ausFinancialYear(d.date)));
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [filtered, groupBy]);

  return {
    query, setQuery,
    kind, setKind,
    fileFormat, setFileFormat,
    fy, setFy, fys,
    groupBy, setGroupBy,
    tenantId, setTenantId,
    sortDir, setSortDir,
    filtered, groups,
  };
}

/**
 * The full filter bar (search, type, file format, financial year, group-by, tenant) plus the
 * table/grouped view — same filtering power the standalone "Other documents" page has, packaged
 * so it can be dropped into any property tab (Purchase, Tenancy, Maintenance, Insurance,
 * Compliance) pre-scoped to that tab's own entries. The Type filter only renders when `entries`
 * actually spans more than one kind (most per-tab lists are already a single kind), and the
 * Tenant filter only renders when `tenantOptions` is given a non-empty list.
 */
export function DocumentsPanel({
  title,
  entries,
  tenantOptions,
  searchPlaceholder = "Search documents…",
  emptyMessage = "No documents on file yet.",
}: {
  title: string;
  entries: DocumentEntry[];
  tenantOptions?: { id: string; name: string }[];
  searchPlaceholder?: string;
  emptyMessage?: string;
}) {
  const {
    query, setQuery,
    kind, setKind,
    fileFormat, setFileFormat,
    fy, setFy, fys,
    groupBy, setGroupBy,
    tenantId, setTenantId,
    sortDir, setSortDir,
    filtered, groups,
  } = useDocumentFilters(entries);

  const kindOptions = useMemo(() => [...new Set(entries.map((e) => e.kind))], [entries]);

  return (
    <div>
      <div className="mb-2 text-sm font-medium">
        {title} ({entries.length})
      </div>
      {entries.length === 0 ? (
        <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
          <FolderOpen className="mx-auto mb-1 h-4 w-4" />
          {emptyMessage}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={searchPlaceholder}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-8 w-[160px] pl-7 text-xs"
              />
            </div>
            {kindOptions.length > 1 && (
              <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
                <SelectTrigger className="h-8 w-[150px] text-xs">
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All types</SelectItem>
                  {kindOptions.map((k) => (
                    <SelectItem key={k} value={k}>
                      {k}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select value={fileFormat} onValueChange={(v) => setFileFormat(v as typeof fileFormat)}>
              <SelectTrigger className="h-8 w-[130px] text-xs">
                <SelectValue placeholder="File" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All files</SelectItem>
                {FILE_FORMATS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={fy} onValueChange={setFy}>
              <SelectTrigger className="h-8 w-[120px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All time</SelectItem>
                {fys.map((y) => (
                  <SelectItem key={y} value={y}>
                    FY {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={groupBy} onValueChange={(v) => setGroupBy(v as typeof groupBy)}>
              <SelectTrigger className="h-8 w-[140px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No grouping</SelectItem>
                <SelectItem value="month">By month</SelectItem>
                <SelectItem value="fy">By financial year</SelectItem>
              </SelectContent>
            </Select>
            {tenantOptions && tenantOptions.length > 0 && (
              <Select value={tenantId} onValueChange={setTenantId}>
                <SelectTrigger className="h-8 w-[150px] text-xs">
                  <SelectValue placeholder="All tenants" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All tenants</SelectItem>
                  {tenantOptions.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
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

          <div className="rounded-md border">
            {groupBy === "none" || !groups ? (
              <DocTable rows={filtered} showProperty={false} />
            ) : (
              <div className="space-y-2 p-2">
                {groups.length === 0 && (
                  <div className="p-4 text-center text-sm text-muted-foreground">No documents match these filters.</div>
                )}
                {groups.map(([key, groupRows]) => (
                  <DocGroupSection
                    key={key}
                    label={key === "unknown" ? "Unknown date" : groupBy === "month" ? formatDocMonthLabel(key) : `FY ${key}`}
                    rows={groupRows}
                    showProperty={false}
                  />
                ))}
              </div>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {filtered.length} of {entries.length} document{entries.length === 1 ? "" : "s"}
          </div>
        </div>
      )}
    </div>
  );
}
