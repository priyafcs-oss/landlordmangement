import { useState } from "react";
import { useStore } from "@/lib/store";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ProposalCard } from "@/components/PropertyShared";
import type { AiIntakeProposal } from "@/lib/types";

export function InboxProposalDialog({
  proposal,
  trigger,
}: {
  proposal: AiIntakeProposal;
  trigger: React.ReactNode;
}) {
  const { dismissProposal } = useStore();
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Review proposal</DialogTitle>
        </DialogHeader>
        <ProposalCard
          proposal={proposal}
          onDismiss={() => {
            dismissProposal(proposal.id);
            setOpen(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
