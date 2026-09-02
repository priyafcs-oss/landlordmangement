import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useStore } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DocTable,
  DocGroupSection,
  formatDocMonthLabel,
  FILE_FORMATS,
  useDocumentFilters,
} from "@/components/DocumentEntryRow";
import { buildDocumentEntries, type DocumentEntry } from "@/lib/documents";

export const Route = createFileRoute("/documents")({
  head: () => ({
    meta: [
      { title: "Other documents — Landlord OS" },
      { name: "description", content: "Condition reports, bank statements and unrecognised documents that don't yet have a dedicated home on a property's own tabs." },
    ],
  }),
  component: DocumentsPage,
});

/** Kinds that don't yet have a dedicated home on a property's own tabs — everything else
 * (leases, purchase docs, loan docs, depreciation reports, maintenance receipts, management
 * agreements) now surfaces on the tab that actually owns that data instead of only here. */
const DOCUMENTS_TAB_KINDS: DocumentEntry["kind"][] = ["Condition Report", "Bank Statement", "Unrecognised"];

function DocumentsPage() {
  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Other documents</h1>
        <p className="text-sm text-muted-foreground">
          Condition reports, bank statements and anything unrecognised, kept here for reference.
          Leases, purchase documents, loan documents, depreciation reports and maintenance
          receipts each live on their own property tab now instead — this is just what's left
          without a dedicated home.
        </p>
      </div>
      <DocumentsContent />
    </div>
  );
}

/** Extracted so the Assets left-nav and a property's own Documents section can embed the same
 * content — passing `propertyId` locks the view to that one property (hides the property picker,
 * same lockedPropertyId pattern as LedgerTab/BillsBoard) without the page-level heading. */
export function DocumentsContent({ propertyId: lockedPropertyId }: { propertyId?: string } = {}) {
  const { state } = useStore();
  const [propertyFilter, setPropertyFilter] = useState("__all__");
  const [tab, setTab] = useState<"all" | "needsHome">("all");
  const propertyId = lockedPropertyId ?? propertyFilter;

  const entries = buildDocumentEntries(state);

  const needsHome = (d: DocumentEntry) => !d.propertyId;
  // Scoped to the property picker only (not Type/File/search) — mirrors the reference design,
  // where the Insights panel and tab counts describe everything filed here, not the current
  // working filter on the table below. Also restricted to the kinds that don't have a dedicated
  // home on a property's own tabs (see DOCUMENTS_TAB_KINDS) — orthogonal to the "needs a home"
  // (unmatched propertyId) filter below.
  const scoped = entries.filter(
    (d) => DOCUMENTS_TAB_KINDS.includes(d.kind) && (propertyId === "__all__" || d.propertyId === propertyId),
  );
  const tabbed = tab === "needsHome" ? scoped.filter(needsHome) : scoped;

  const { query, setQuery, kind, setKind, fileFormat, setFileFormat, fy, setFy, fys, groupBy, setGroupBy, tenantId, setTenantId, filtered, groups } =
    useDocumentFilters(tabbed);

  const lastAdded = scoped.reduce<string>((latest, d) => (d.date > latest ? d.date : latest), "");
  const byType = Object.entries(
    scoped.reduce<Record<string, number>>((acc, d) => {
      acc[d.kind] = (acc[d.kind] ?? 0) + 1;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);
  const maxByType = Math.max(1, ...byType.map(([, count]) => count));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setTab("all")}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            tab === "all" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"
          }`}
        >
          All ({scoped.length})
        </button>
        <button
          type="button"
          onClick={() => setTab("needsHome")}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            tab === "needsHome" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"
          }`}
        >
          Needs a home ({scoped.filter(needsHome).length})
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Search documents…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="max-w-[220px]"
            />
            <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All types</SelectItem>
                <SelectItem value="Condition Report">Condition reports</SelectItem>
                <SelectItem value="Bank Statement">Bank statements</SelectItem>
                <SelectItem value="Unrecognised">Unrecognised</SelectItem>
              </SelectContent>
            </Select>
            <Select value={fileFormat} onValueChange={(v) => setFileFormat(v as typeof fileFormat)}>
              <SelectTrigger className="w-[140px]">
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
              <SelectTrigger className="w-[130px]">
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
              <SelectTrigger className="w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No grouping</SelectItem>
                <SelectItem value="month">By month</SelectItem>
                <SelectItem value="fy">By financial year</SelectItem>
              </SelectContent>
            </Select>
            <Select value={tenantId} onValueChange={setTenantId}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="All tenants" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All tenants</SelectItem>
                {state.tenants
                  .filter((t) => propertyId === "__all__" || t.propertyId === propertyId)
                  .map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            {!lockedPropertyId && (
              <Select value={propertyFilter} onValueChange={setPropertyFilter}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="All properties" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All properties</SelectItem>
                  {state.properties.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.alias || p.address}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <Card>
            {groupBy === "none" || !groups ? (
              <DocTable rows={filtered} showProperty={!lockedPropertyId} />
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
                    showProperty={!lockedPropertyId}
                  />
                ))}
              </div>
            )}
            <div className="border-t px-3 py-2 text-xs text-muted-foreground">
              {filtered.length} of {tabbed.length} document{tabbed.length === 1 ? "" : "s"}
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Documents</CardTitle>
              <div className="text-xs text-muted-foreground">
                {lockedPropertyId ? "Filed for this property" : "Filed across your portfolio"}
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="text-2xl font-semibold tracking-tight">{scoped.length}</div>
              <div className="flex items-center justify-between border-t pt-3">
                <span className="text-muted-foreground">Last added</span>
                <span className="font-medium">{lastAdded || "—"}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">By type</CardTitle>
              <div className="text-xs text-muted-foreground">Documents by category</div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {byType.length === 0 && <div className="text-xs text-muted-foreground">No documents yet.</div>}
              {byType.map(([k, count]) => (
                <div key={k}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{k}</span>
                    <span className="font-medium">{count}</span>
                  </div>
                  <div className="mt-1 h-1.5 w-full rounded-full bg-muted">
                    <div className="h-1.5 rounded-full bg-emerald-500" style={{ width: `${(count / maxByType) * 100}%` }} />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

