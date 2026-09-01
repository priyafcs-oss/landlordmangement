import { FolderOpen } from "lucide-react";
import { DocumentLink } from "@/components/DocumentLink";
import type { DocumentEntry } from "@/lib/documents";

/**
 * Small reusable "Documents" section for a single property tab (Tenancy, Purchase & Acquisition,
 * Loans, Depreciation) — a lighter-weight row than the full portfolio-wide Documents table
 * (DocTable in documents.tsx), since each of these is always pre-filtered to one property and one
 * or two document kinds.
 */
export function DocumentsSection({ title, entries }: { title: string; entries: DocumentEntry[] }) {
  return (
    <div>
      <div className="mb-2 text-sm font-medium">
        {title} ({entries.length})
      </div>
      {entries.length === 0 ? (
        <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
          <FolderOpen className="mx-auto mb-1 h-4 w-4" />
          No documents on file yet.
        </div>
      ) : (
        <div className="space-y-1">
          {entries.map((d) => (
            <div key={`${d.kind}-${d.id}`} className="flex items-center justify-between gap-2 rounded border p-2 text-xs">
              <div className="min-w-0">
                <div className="truncate font-medium">{d.label}</div>
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
          ))}
        </div>
      )}
    </div>
  );
}
