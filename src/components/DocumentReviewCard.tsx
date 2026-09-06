import { createContext, useContext, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { BillDocumentViewer } from "@/components/BillDocumentViewer";
import { useStore } from "@/lib/store";
import { ChevronDown, ChevronRight, PanelRightClose, PanelRightOpen, RefreshCw } from "lucide-react";
import type { AiIntakeProposal } from "@/lib/types";

/** Set by `ProposalReviewDialog` (the after-upload review popup) so its "Review later" action is
 * reachable from `ReviewActionsBar` below — unset (no button rendered) for every other place
 * DocumentReviewCard is used, e.g. the inline Assets-page pending list, which has no separate
 * "review later" concept to begin with. */
export const ReviewLaterContext = createContext<(() => void) | null>(null);

/** Set by a kind-specific card (e.g. RentLedgerProposalCard) that supports re-running the AI
 * reader on its own source file — lets `ReviewActionsBar` render one consistent "Re-parse
 * document" button regardless of which of DocumentReviewCard's three render paths is active,
 * instead of every kind duplicating its own reparse button placement. Unset for kinds that don't
 * offer this (most of them still handle reclassify/reparse with their own bespoke UI, e.g.
 * UnclassifiedProposalCard's "reclassify as" picker). */
export const ReparseContext = createContext<{ reparse: () => void; reparsing: boolean } | null>(null);

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

/** One consistent top bar for every place DocumentReviewCard shows its full two-pane content —
 * "view document only" (hides the form, widens the document pane to fill the space) plus whichever
 * of Re-parse/Review later apply from context. Renders nothing (not even a border) when neither
 * context is set and no document exists to toggle to, so a plain inline-list card stays exactly as
 * minimal as before. */
function ReviewActionsBar({
  hasDocument,
  docOnly,
  setDocOnly,
}: {
  hasDocument: boolean;
  docOnly: boolean;
  setDocOnly: (v: boolean) => void;
}) {
  const reviewLater = useContext(ReviewLaterContext);
  const reparseCtx = useContext(ReparseContext);
  if (!hasDocument && !reparseCtx && !reviewLater) return null;
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b pb-2">
      {hasDocument ? (
        <Button size="sm" variant="outline" className="gap-1" onClick={() => setDocOnly(!docOnly)}>
          {docOnly ? (
            <>
              <PanelRightOpen className="h-3.5 w-3.5" /> Show details
            </>
          ) : (
            <>
              <PanelRightClose className="h-3.5 w-3.5" /> View document only
            </>
          )}
        </Button>
      ) : (
        <span />
      )}
      <div className="flex items-center gap-2">
        {reparseCtx && (
          <Button
            size="sm"
            variant="ghost"
            className="gap-1 text-muted-foreground"
            disabled={reparseCtx.reparsing}
            onClick={reparseCtx.reparse}
            title="Re-run the AI reader on the original file — useful if it missed or misread a line. Dismisses this version."
          >
            <RefreshCw className={`h-3.5 w-3.5 ${reparseCtx.reparsing ? "animate-spin" : ""}`} />
            {reparseCtx.reparsing ? "Re-parsing…" : "Re-parse document"}
          </Button>
        )}
        {reviewLater && (
          <Button variant="ghost" size="sm" onClick={reviewLater}>
            Review later
          </Button>
        )}
      </div>
    </div>
  );
}

/** Shared two-pane review shell used for every pending ai_intake_proposals kind — source document
 * on the left, common fields (provider/date/addressed-to, when known) plus the kind-specific body
 * on the right. Each kind's own card keeps its own badge, property/tenant pickers, and confirm
 * logic untouched; this just wraps it and centralizes the document view + common header.
 *
 * Two entry points render this differently:
 * - Inline in the Assets-page pending list (no ReviewLaterContext) — collapsed to a single summary
 *   line by default, since a landlord with several pending documents was getting a wall of
 *   fully-expanded cards for every one of them; "Enlarge" opens this same content in its own
 *   fullscreen Dialog.
 * - Inside `ProposalReviewDialog` (ReviewLaterContext set, meaning the landlord already explicitly
 *   chose to review this one document) — opens straight into the full two-pane layout with no
 *   collapse-then-expand step, filling the dialog ProposalReviewDialog already sized to near-
 *   fullscreen, rather than opening a second nested Dialog on top of it.
 */
export function DocumentReviewCard({ proposal, children }: { proposal: AiIntakeProposal; children: React.ReactNode }) {
  const { state } = useStore();
  const reviewLater = useContext(ReviewLaterContext);
  const singleReview = reviewLater !== null;
  const [expanded, setExpanded] = useState(false);
  // There's no host dialog here to resize (unlike Add Bill/Transaction) — this card is inline on
  // the page — so "Enlarge" instead opens its own full-screen Dialog with both panes. The inline
  // expanded view is hidden while it's open (rather than left mounted underneath) so the
  // kind-specific `children` form isn't mounted twice at once with two independently-typed copies.
  const [fullscreen, setFullscreen] = useState(false);
  const [docOnly, setDocOnly] = useState(false);
  const hasDocument = !!proposal.sourceFileData || !!proposal.sourceEmailBody;
  const property = proposal.propertyId ? state.properties.find((p) => p.id === proposal.propertyId) : undefined;
  const meta = [
    proposal.providerName && { label: "Provider", value: proposal.providerName },
    proposal.documentDate && { label: "Date", value: proposal.documentDate },
    proposal.addressedTo && { label: "Addressed to", value: proposal.addressedTo },
  ].filter(Boolean) as { label: string; value: string }[];
  const reviewReasons = (proposal.reviewReason ?? "").split("; ").filter(Boolean);

  const twoPane = (fullSize: boolean) => (
    <div className={`flex ${fullSize ? "h-full" : ""} min-h-0 flex-1 flex-col gap-3`}>
      <ReviewActionsBar hasDocument={hasDocument} docOnly={docOnly} setDocOnly={setDocOnly} />
      <div
        className={
          docOnly
            ? "min-h-0 flex-1 overflow-y-auto"
            : `grid min-h-0 flex-1 gap-4 overflow-hidden ${fullSize ? "lg:grid-cols-[minmax(0,1fr)_380px]" : "lg:grid-cols-[minmax(0,320px)_1fr]"}`
        }
      >
        <div className={fullSize || docOnly ? "overflow-y-auto" : "lg:sticky lg:top-4 lg:self-start"}>
          <DocumentPane proposal={proposal} expanded={fullSize || docOnly} onToggleExpand={() => setFullscreen((v) => !v)} />
        </div>
        {!docOnly && <div className="min-w-0 space-y-2 overflow-y-auto pr-1">{children}</div>}
      </div>
    </div>
  );

  // Reviewing one specific document via ProposalReviewDialog — the parent dialog already provides
  // the modal chrome/sizing at near-fullscreen, so render straight into it with no collapse step
  // and no second nested Dialog.
  if (singleReview) {
    return twoPane(true);
  }

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

        {expanded && !fullscreen && twoPane(false)}
      </CardContent>
    </Card>

    <Dialog open={fullscreen} onOpenChange={setFullscreen}>
      <DialogContent className="flex h-[95vh] max-h-[95vh] w-[95vw] max-w-[95vw] flex-col overflow-hidden p-4">
        <DialogTitle className="sr-only">{KIND_LABELS[proposal.kind] ?? proposal.kind}</DialogTitle>
        {twoPane(true)}
      </DialogContent>
    </Dialog>
    </>
  );
}
