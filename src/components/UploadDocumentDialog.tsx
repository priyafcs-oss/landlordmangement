import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FileUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/lib/store";
import { ProposalReviewDialog } from "@/components/PropertyShared";
import { MAX_AI_UPLOAD_BYTES, formatFileSize } from "@/lib/files";
import { toast } from "sonner";

interface UploadResult {
  ok: boolean;
  skipped?: boolean;
  billId?: string;
  proposalId?: string;
  status?: string;
  error?: string;
}

/**
 * Same classify → extract → stage pipeline the email inbox uses (parse-inbound-bill's
 * router), just fed from a direct upload instead of a forwarded email — for bills, rent
 * statements, lease agreements or property documents (settlement statements, insurance
 * certificates, strata notices) the landlord has as a file rather than an email attachment.
 */
export function UploadDocumentDialog() {
  const { refresh } = useStore();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewProposalId, setReviewProposalId] = useState<string | null>(null);

  const upload = async () => {
    if (!file) return toast.error("Choose a file first");
    if (file.size > MAX_AI_UPLOAD_BYTES) {
      return toast.error(
        `This file is ${formatFileSize(file.size)} — the AI reader can only handle files up to ${formatFileSize(MAX_AI_UPLOAD_BYTES)}. Try a lower-resolution scan, or split it into smaller files.`,
      );
    }
    setBusy(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Couldn't read file"));
        reader.readAsDataURL(file);
      });
      const base64 = dataUrl.split(",")[1] ?? "";
      const { data, error } = await supabase.functions.invoke<UploadResult>("upload-document", {
        body: { fileBase64: base64, fileName: file.name, mimeType: file.type || "application/pdf" },
      });
      if (error) throw error;
      if (!data?.ok) {
        toast.error(data?.error || "Couldn't process this document");
        return;
      }
      if (data.skipped) {
        toast.info("Uploaded, but it didn't look like a bill, lease, rent statement or property document — nothing recorded.");
      } else {
        if (data.billId) {
          toast.success("Bill uploaded — it'll post to P&L once marked paid");
        } else if (data.proposalId) {
          toast.success("Uploaded — review it now, or leave it for later on the Dashboard / Assets → All Assets");
        } else {
          toast.success("Document processed");
        }
        // The edge function writes the row server-side, so the client store's cached
        // state doesn't know about it yet — without this, the new proposal/bill
        // stays invisible on the Dashboard/Assets until the next full page load.
        await refresh();
        if (data.proposalId) setReviewProposalId(data.proposalId);
      }
      setOpen(false);
      setFile(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1">
            <FileUp className="h-4 w-4" /> Upload document
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload a bill, rent statement, lease or property document</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Same AI reader as the email inbox — a PDF or photo of a council/water bill, agent rent statement, lease
              agreement, settlement statement, insurance certificate or strata notice. It's matched to a property and
              staged for your review the same way an emailed document would be.
            </p>
            <Input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <p className="text-xs text-muted-foreground">
              Max {formatFileSize(MAX_AI_UPLOAD_BYTES)} — a large scanned document (e.g. building plans) may need to be
              compressed or split first.
            </p>
          </div>
          <DialogFooter>
            <Button onClick={upload} disabled={!file || busy}>
              {busy ? "Processing…" : "Upload & process"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ProposalReviewDialog
        proposalId={reviewProposalId}
        onOpenChange={(v) => {
          if (!v) setReviewProposalId(null);
        }}
      />
    </>
  );
}
