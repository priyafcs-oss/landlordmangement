import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useStore } from "@/lib/store";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Inbox as InboxIcon, Paperclip, TriangleAlert } from "lucide-react";
import type { EmailInboxLogEntry } from "@/lib/types";

export const Route = createFileRoute("/inbox")({
  head: () => ({
    meta: [
      { title: "Inbox — Landlord OS" },
      { name: "description", content: "Every email received on the forwarding inbox, including ones that failed or were skipped." },
    ],
  }),
  component: InboxPage,
});

const STATUS_LABEL: Record<EmailInboxLogEntry["status"], string> = {
  processed: "Processed",
  staged: "Staged for review",
  skipped: "Skipped",
  failed: "Failed",
};

const STATUS_BADGE_CLASS: Record<EmailInboxLogEntry["status"], string> = {
  processed: "border-emerald-300 bg-emerald-50 text-emerald-700",
  staged: "border-amber-300 bg-amber-50 text-amber-700",
  skipped: "border-muted text-muted-foreground",
  failed: "border-destructive/40 bg-destructive/10 text-destructive",
};

const DOCUMENT_TYPE_LABEL: Record<string, string> = {
  bill: "Bill",
  lease_agreement: "Lease agreement",
  rent_statement: "Rent statement",
  property_document: "Property document",
  depreciation_report: "Depreciation report",
  loan_document: "Loan document",
  loan_statement: "Loan statement",
  bank_statement: "Bank statement",
  property_sale: "Property sale",
  other: "Unrecognised",
};

function InboxPage() {
  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
        <p className="text-sm text-muted-foreground">
          Every email received on the forwarding address — including ones that failed to parse or were skipped —
          not just the ones that made it into Documents.
        </p>
      </div>
      <InboxContent />
    </div>
  );
}

/** Extracted so the Assets left-nav can embed the same content without the page-level heading. */
export function InboxContent() {
  const { state } = useStore();
  const [status, setStatus] = useState<"__all__" | EmailInboxLogEntry["status"]>("__all__");
  const [query, setQuery] = useState("");

  const entries = [...state.emailInboxLog].sort((a, b) => (a.created_at ?? "") < (b.created_at ?? "") ? 1 : -1);

  const filtered = entries.filter((e) => {
    if (status !== "__all__" && e.status !== status) return false;
    if (query && !`${e.subject ?? ""} ${e.fromAddress ?? ""}`.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  const failedCount = entries.filter((e) => e.status === "failed").length;

  return (
    <div className="space-y-6">
      {failedCount > 0 && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="flex items-center gap-2 p-3 text-sm text-destructive">
            <TriangleAlert className="h-4 w-4 shrink-0" />
            {failedCount} email{failedCount === 1 ? "" : "s"} failed to process — check below for what went wrong.
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search subject or sender…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-[240px]"
        />
        <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All statuses</SelectItem>
            <SelectItem value="processed">Processed</SelectItem>
            <SelectItem value="staged">Staged for review</SelectItem>
            <SelectItem value="skipped">Skipped</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        {filtered.length === 0 && (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              <InboxIcon className="mx-auto mb-2 h-6 w-6" />
              {entries.length === 0
                ? "No emails received yet — this fills in as soon as something's forwarded to the inbox."
                : "No emails match these filters."}
            </CardContent>
          </Card>
        )}
        {filtered.map((e) => (
          <Card key={e.id}>
            <CardContent className="space-y-1 p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={STATUS_BADGE_CLASS[e.status]}>
                  {STATUS_LABEL[e.status]}
                </Badge>
                {e.documentType && <Badge variant="secondary">{DOCUMENT_TYPE_LABEL[e.documentType] ?? e.documentType}</Badge>}
                <span className="font-medium">{e.subject || "(no subject)"}</span>
                {e.hasAttachment && <Paperclip className="h-3 w-3 text-muted-foreground" />}
              </div>
              <div className="text-xs text-muted-foreground">
                {e.fromAddress || "Unknown sender"} • {e.created_at ? new Date(e.created_at).toLocaleString() : "—"}
                {e.attachmentFileName && ` • ${e.attachmentFileName}`}
              </div>
              {e.status === "failed" && e.errorMessage && (
                <div className="mt-1 rounded border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
                  {e.errorMessage}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
