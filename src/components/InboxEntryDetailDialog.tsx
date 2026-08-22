import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { DOCUMENT_TYPE_LABEL } from "@/lib/inboxLabels";
import type { EmailInboxLogEntry, PropertyBill, AiIntakeProposal } from "@/lib/types";

export function InboxEntryDetailDialog({
  entry,
  bill,
  proposal,
  trigger,
}: {
  entry: EmailInboxLogEntry;
  bill?: PropertyBill;
  proposal?: AiIntakeProposal;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{entry.subject || "(no subject)"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          <div className="text-muted-foreground">
            From {entry.fromAddress || "Unknown sender"}
            {entry.created_at && ` • ${new Date(entry.created_at).toLocaleString()}`}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {entry.documentType && (
              <Badge variant="secondary">{DOCUMENT_TYPE_LABEL[entry.documentType] ?? entry.documentType}</Badge>
            )}
            {entry.hasAttachment && (
              <Badge variant="outline">{entry.attachmentFileName || "Attachment"}</Badge>
            )}
          </div>
          {entry.errorMessage && (
            <div className="rounded border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
              {entry.errorMessage}
            </div>
          )}
          {entry.billId && !bill && (
            <div className="rounded border border-muted p-2 text-xs text-muted-foreground">
              The bill this email created has since been deleted.
            </div>
          )}
          {entry.proposalId && !proposal && (
            <div className="rounded border border-muted p-2 text-xs text-muted-foreground">
              The proposal this email created has since been deleted.
            </div>
          )}
          {proposal && proposal.status !== "pending" && (
            <div className="rounded border border-muted p-2 text-xs text-muted-foreground">
              This proposal has already been reviewed ({proposal.status}).
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
