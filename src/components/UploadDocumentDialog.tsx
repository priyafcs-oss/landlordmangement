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
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [reviewProposalId, setReviewProposalId] = useState<string | null>(null);

  const uploadOne = async (file: File): Promise<UploadResult | { ok: false; error: string }> => {
    if (file.size > MAX_AI_UPLOAD_BYTES) {
      return {
        ok: false,
        error: `${file.name} is ${formatFileSize(file.size)} — the AI reader can only handle files up to ${formatFileSize(MAX_AI_UPLOAD_BYTES)}. Try a lower-resolution scan, or split it into smaller files.`,
      };
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error(`Couldn't read ${file.name}`));
      reader.readAsDataURL(file);
    });
    const base64 = dataUrl.split(",")[1] ?? "";
    const { data, error } = await supabase.functions.invoke<UploadResult>("upload-document", {
      body: { fileBase64: base64, fileName: file.name, mimeType: file.type || "application/pdf" },
    });
    if (error) throw error;
    return data ?? { ok: false, error: "Couldn't process this document" };
  };

  // Sequential rather than Promise.all — avoids slamming the AI-extraction edge function with a
  // burst of concurrent invocations when someone selects a whole folder's worth of scans at once.
  const upload = async () => {
    if (files.length === 0) return toast.error("Choose at least one file first");
    setBusy(true);
    try {
      const results: { file: File; data: UploadResult | { ok: false; error: string } }[] = [];
      for (const file of files) {
        try {
          results.push({ file, data: await uploadOne(file) });
        } catch (e) {
          results.push({ file, data: { ok: false, error: e instanceof Error ? e.message : "Upload failed" } });
        }
      }

      const failed = results.filter((r) => !r.data.ok);
      const skipped = results.filter((r) => r.data.ok && "skipped" in r.data && r.data.skipped);
      const billed = results.filter((r) => r.data.ok && "billId" in r.data && r.data.billId);
      const proposals = results.filter((r) => r.data.ok && "proposalId" in r.data && r.data.proposalId);

      failed.forEach((r) => toast.error(`${r.file.name}: ${"error" in r.data ? r.data.error : "Couldn't process this document"}`));
      if (skipped.length > 0) {
        toast.info(
          skipped.length === 1
            ? `${skipped[0].file.name} didn't look like a bill, lease, rent statement or property document — nothing recorded.`
            : `${skipped.length} files didn't look like a bill, lease, rent statement or property document — nothing recorded.`,
        );
      }
      if (billed.length > 0) {
        toast.success(billed.length === 1 ? "Bill uploaded — it'll post to P&L once marked paid" : `${billed.length} bills uploaded — they'll post to P&L once marked paid`);
      }
      if (proposals.length === 1) {
        toast.success("Uploaded — review it now, or leave it for later on the Dashboard / Assets → All Assets");
      } else if (proposals.length > 1) {
        toast.success(`${proposals.length} documents uploaded — review them on the Dashboard / Assets → All Assets`);
      }

      if (results.some((r) => r.data.ok)) {
        // The edge function writes rows server-side, so the client store's cached state doesn't
        // know about them yet — without this, new proposals/bills stay invisible on the
        // Dashboard/Assets until the next full page load.
        await refresh();
      }
      // Only jump straight into the review dialog for a single-file upload — with several files
      // at once, each pending proposal already renders as its own stacked review card on the
      // Dashboard/Assets "needs review" list, so there's no need for a one-at-a-time flow here.
      if (proposals.length === 1 && "proposalId" in proposals[0].data) {
        setReviewProposalId(proposals[0].data.proposalId ?? null);
      }
      if (failed.length === 0) {
        setOpen(false);
        setFiles([]);
      } else {
        // Keep only the failed files selected so retrying doesn't resubmit ones that already
        // succeeded.
        setFiles(failed.map((r) => r.file));
      }
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
            <DialogTitle>Upload a bill, rent statement, lease, management agreement or property document</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Same AI reader as the email inbox — a PDF or photo of a council/water bill, agent rent statement, lease
              agreement, signed management/agency agreement, settlement statement, insurance certificate or strata
              notice. It's matched to a property and staged for your review the same way an emailed document would be.
            </p>
            <Input
              type="file"
              accept="application/pdf,image/*"
              multiple
              onChange={(e) => setFiles(e.target.files ? Array.from(e.target.files) : [])}
            />
            {files.length > 1 && (
              <p className="text-xs text-muted-foreground">
                {files.length} files selected — each is read and matched individually, one after another.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Max {formatFileSize(MAX_AI_UPLOAD_BYTES)} per file — a large scanned document (e.g. building plans) may
              need to be compressed or split first.
            </p>
          </div>
          <DialogFooter>
            <Button onClick={upload} disabled={files.length === 0 || busy}>
              {busy ? "Processing…" : files.length > 1 ? `Upload & process ${files.length} files` : "Upload & process"}
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
