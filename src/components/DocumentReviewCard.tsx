import { createContext, useContext, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { BillDocumentViewer } from "@/components/BillDocumentViewer";
import { useStore } from "@/lib/store";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { AiIntakeProposal } from "@/lib/types";

/** Set by `ProposalReviewDialog` (the after-upload review popup) so its "Review later" action
 * stays reachable from inside the fullscreen enlarge view below, which opens its own nested Dialog
 * that visually covers the outer dialog's own footer. Unset (no button rendered) for every other
 * place DocumentReviewCard is used, e.g. the inline Assets-page pending list, which has no
 * separate "review later" concept to begin with. */
export const ReviewLaterContext = createContext<(() => void) | null>(null);

const KIND_LABELS: Record<AiIntakeProposal["kind"], string> = {
  bill: "Bill",
  expense: "Transaction",
  tenant_lease: "Lease agreement",
  rent_ledger: "Rent statement",
  property_detail: "Property update",
  depreciation_report: "Depreciation report",
  unclassified: "Unclassified document",
  loan_document: "Loan document",
  loan_statement: "Loan statement",
  bank_statement: "Bank statement",
  property_sale: "Property sale",
  agency_agreement: "Management agreement",
};

/** Left-pane source-document view shared by every kind — the actual PDF/image when there's an
 * attachment, the raw email text when there isn't, or BillDocumentViewer's own empty state when
 * neither exists. Centralizing this here means the per-kind cards no longer need their own
 * click-to-view link/modal for the same document. */
function DocumentPane({
  proposal,
  expanded,
  onToggleExpand,
}: {
  proposal: AiIntakeProposal;
  expanded?: boolean;
  onToggleExpand?: () => void;
}) {
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
  return (
    <BillDocumentViewer
      fileName={proposal.sourceFileName}
      fileData={proposal.sourceFileData}
      expanded={expanded}
      onToggleExpand={onToggleExpand}
    />
  );
}

/** Shared two-pane review shell used for every pending ai_intake_proposals kind — source document
 * on the left, common fields (provider/date/addressed-to, when known) plus the kind-specific body
 * on the right. Each kind's own card keeps its own badge, property/tenant pickers, and confirm
 * logic untouched; this just wraps it and centralizes the document view + common header.
 *
 * Collapsed to a single summary line by default — a landlord with several pending documents was
 * getting a wall of fully-expanded cards (file preview + every field) for every one of them. "bill"
 * and "expense" proposals already had a compact row of their own (BillProposalRow/ExpenseProposalRow,
 * opening the real Add Bill/Transaction dialog); this brings every other kind in line with that same
 * collapse-until-asked-for pattern without needing each kind's own card to know about it. */
export function DocumentReviewCard({ proposal, children }: { proposal: AiIntakeProposal; children: React.ReactNode }) {
  const { state } = useStore();
  const reviewLater = useContext(ReviewLaterContext);
  const [expanded, setExpanded] = useState(false);
  // There's no host dialog here to resize (unlike Add Bill/Transaction) — this card is inline on
  // the page — so "Enlarge" instead opens its own full-screen Dialog with both panes. The inline
  // expanded view is hidden while it's open (rather than left mounted underneath) so the
  // kind-specific `children` form isn't mounted twice at once with two independently-typed copies.
  const [fullscreen, setFullscreen] = useState(false);
  const property = proposal.propertyId ? state.properties.find((p) => p.id === proposal.propertyId) : undefined;
  const meta = [
    proposal.providerName && { label: "Provider", value: proposal.providerName },
    proposal.documentDate && { label: "Date", value: proposal.documentDate },
    proposal.addressedTo && { label: "Addressed to", value: proposal.addressedTo },
  ].filter(Boolean) as { label: string; value: string }[];
  const reviewReasons = (proposal.reviewReason ?? "").split("; ").filter(Boolean);

  return (
    <>
    <Card className="border-amber-500/30">
      <CardContent className="space-y-3 p-4">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
        >
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
            <Badge variant="secondary">{KIND_LABELS[proposal.kind] ?? proposal.kind}</Badge>
            {(property || proposal.rawPropertyAddress) && (
              <span className="font-medium">{property?.alias || property?.address || proposal.rawPropertyAddress}</span>
            )}
            {meta.map((m) => (
              <span key={m.label} className="text-muted-foreground">
                {m.label}: <span className="text-foreground">{m.value}</span>
              </span>
            ))}
            {reviewReasons.map((r) => (
              <Badge key={r} variant="destructive">
                {r}
              </Badge>
            ))}
          </div>
          <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-primary">
            {expanded ? (
              <>
                Hide <ChevronDown className="h-3.5 w-3.5" />
              </>
            ) : (
              <>
                View / Expand <ChevronRight className="h-3.5 w-3.5" />
              </>
            )}
          </span>
        </button>

        {expanded && !fullscreen && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_1fr]">
            <div className="lg:sticky lg:top-4 lg:self-start">
              <DocumentPane proposal={proposal} expanded={false} onToggleExpand={() => setFullscreen(true)} />
            </div>
            <div className="min-w-0 space-y-2">{children}</div>
          </div>
        )}
      </CardContent>
    </Card>

    <Dialog open={fullscreen} onOpenChange={setFullscreen}>
      <DialogContent className="flex h-[95vh] max-h-[95vh] w-[95vw] max-w-[95vw] flex-col overflow-hidden p-4">
        <DialogTitle className="sr-only">{KIND_LABELS[proposal.kind] ?? proposal.kind}</DialogTitle>
        {reviewLater && (
          <div className="flex shrink-0 justify-end pr-10">
            <Button variant="ghost" size="sm" onClick={reviewLater}>
              Review later
            </Button>
          </div>
        )}
        <div className="grid flex-1 gap-4 overflow-hidden lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="overflow-y-auto">
            <DocumentPane proposal={proposal} expanded onToggleExpand={() => setFullscreen(false)} />
          </div>
          <div className="min-w-0 space-y-2 overflow-y-auto pr-1">{children}</div>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}
