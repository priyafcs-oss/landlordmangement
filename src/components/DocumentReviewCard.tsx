import { Card, CardContent } from "@/components/ui/card";
import { BillDocumentViewer } from "@/components/BillDocumentViewer";
import type { AiIntakeProposal } from "@/lib/types";

/** Left-pane source-document view shared by every kind — the actual PDF/image when there's an
 * attachment, the raw email text when there isn't, or BillDocumentViewer's own empty state when
 * neither exists. Centralizing this here means the per-kind cards no longer need their own
 * click-to-view link/modal for the same document. */
function DocumentPane({ proposal }: { proposal: AiIntakeProposal }) {
  if (!proposal.sourceFileData && proposal.sourceEmailBody) {
    return (
      <div className="flex h-full min-h-[300px] flex-col overflow-hidden rounded-md border">
        <div className="truncate border-b bg-muted/40 px-2 py-1 text-xs font-medium">
          {proposal.sourceSubject || "Original email"}
        </div>
        <div className="flex-1 overflow-y-auto whitespace-pre-wrap p-2 text-xs">{proposal.sourceEmailBody}</div>
      </div>
    );
  }
  return <BillDocumentViewer fileName={proposal.sourceFileName} fileData={proposal.sourceFileData} />;
}

/** Shared two-pane review shell used for every pending ai_intake_proposals kind — source document
 * on the left, common fields (provider/date/addressed-to, when known) plus the kind-specific body
 * on the right. Each kind's own card keeps its own badge, property/tenant pickers, and confirm
 * logic untouched; this just wraps it and centralizes the document view + common header. */
export function DocumentReviewCard({ proposal, children }: { proposal: AiIntakeProposal; children: React.ReactNode }) {
  const meta = [
    proposal.providerName && { label: "Provider", value: proposal.providerName },
    proposal.documentDate && { label: "Date", value: proposal.documentDate },
    proposal.addressedTo && { label: "Addressed to", value: proposal.addressedTo },
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <Card className="border-amber-500/30">
      <CardContent className="grid gap-4 p-4 lg:grid-cols-[minmax(0,320px)_1fr]">
        <div className="lg:sticky lg:top-4 lg:self-start">
          <DocumentPane proposal={proposal} />
        </div>
        <div className="min-w-0 space-y-2">
          {meta.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 rounded border bg-muted/20 px-2 py-1.5 text-xs">
              {meta.map((m) => (
                <span key={m.label}>
                  <span className="text-muted-foreground">{m.label}:</span> <span className="font-medium">{m.value}</span>
                </span>
              ))}
            </div>
          )}
          {children}
        </div>
      </CardContent>
    </Card>
  );
}
