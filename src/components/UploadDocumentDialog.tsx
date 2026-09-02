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
  /** Set instead of billId when this file matched an existing Expense (e.g. a water bill line
   * already posted from an agent statement, with no invoice on file yet) — the file was attached
   * to that Expense instead of creating a second, disconnected Bill for the same charge. */
  linkedExpenseId?: string;
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
  const [processedCount, setProcessedCount] = useState(0);
  // Ordered ids of proposals ready to review — reviewing the front one and dismissing/confirming
  // it (ProposalReviewDialog auto-closes once the proposal leaves "pending") pops it off the
  // queue and immediately reveals the next one, if it's already finished processing in the
  // background; otherwise it just appears the moment its own processing completes.
  const [reviewQueue, setReviewQueue] = useState<string[]>([]);
  const currentReviewId = reviewQueue[0] ?? null;

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
  // Runs to completion regardless of whether the Upload dialog itself is still open — as soon as
  // the FIRST file produces something to review, the upload dialog hands off to the review dialog
  // and the rest keep processing behind it, landing in reviewQueue as each one finishes instead of
  // making the landlord manually reopen and re-trigger every remaining file one at a time.
  const upload = async () => {
    if (files.length === 0) return toast.error("Choose at least one file first");
    const queued = files;
    setBusy(true);
    setProcessedCount(0);
    try {
      const failedFiles: File[] = [];
      let billedCount = 0;
      let handedOff = false;

      for (const file of queued) {
        let data: UploadResult | { ok: false; error: string };
        try {
          data = await uploadOne(file);
        } catch (e) {
          data = { ok: false, error: e instanceof Error ? e.message : "Upload failed" };
        }
        setProcessedCount((n) => n + 1);

        if (!data.ok) {
          toast.error(`${file.name}: ${"error" in data ? data.error : "Couldn't process this document"}`);
          failedFiles.push(file);
          continue;
        }
        if ("skipped" in data && data.skipped) {
          toast.info(`${file.name} didn't look like a bill, lease, rent statement or property document — nothing recorded.`);
          continue;
        }
        if ("billId" in data && data.billId) billedCount++;
        if ("linkedExpenseId" in data && data.linkedExpenseId) {
          toast.success(`${file.name}: matched an existing expense — invoice attached instead of creating a duplicate`);
        }

        // The edge function writes rows server-side, so the client store's cached state doesn't
        // know about this file's result yet — needed now (not batched at the end) since the next
        // proposal has to actually be in state before the review dialog can find it.
        await refresh();

        if ("proposalId" in data && data.proposalId) {
          setReviewQueue((q) => [...q, data.proposalId!]);
          if (!handedOff) {
            handedOff = true;
            setOpen(false);
          }
        }
      }

      if (billedCount > 0) {
        toast.success(
          billedCount === 1 ? "Bill uploaded — it'll post to P&L once marked paid" : `${billedCount} bills uploaded — they'll post to P&L once marked paid`,
        );
      }
      if (failedFiles.length === 0) {
        setFiles([]);
        if (!handedOff) setOpen(false);
      } else {
        // Keep only the failed files selected so retrying doesn't resubmit ones that already
        // succeeded, and reopen the dialog so they're visible to retry.
        setFiles(failedFiles);
        setOpen(true);
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
            <p className="text-xs font-medium text-foreground">
              You can select several files at once — in the file picker that opens, hold Ctrl (Windows) or Cmd (Mac)
              and click each file, or drag a group of files in together. The first one ready opens for review
              immediately; the rest keep processing in the background and appear one after another as you finish
              each review.
            </p>
            <Input
              type="file"
              accept="application/pdf,image/*"
              multiple
              disabled={busy}
              onChange={(e) => setFiles(e.target.files ? Array.from(e.target.files) : [])}
            />
            {files.length > 0 && !busy && (
              <p className="text-xs text-muted-foreground">
                {files.length} file{files.length === 1 ? "" : "s"} selected
                {files.length > 1 ? " — each is read and matched individually, one after another." : "."}
              </p>
            )}
            {busy && (
              <p className="text-xs text-muted-foreground">
                Processing {processedCount + 1} of {files.length}…
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
        proposalId={currentReviewId}
        onOpenChange={(v) => {
          if (!v) setReviewQueue((q) => q.slice(1));
        }}
      />
    </>
  );
}
