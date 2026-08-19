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
import { toast } from "sonner";

interface UploadResult {
  ok: boolean;
  skipped?: boolean;
  expenseId?: string;
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
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const upload = async () => {
    if (!file) return toast.error("Choose a file first");
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
      } else if (data.expenseId) {
        toast.success(
          data.status === "needs_review"
            ? "Bill uploaded — flagged for review in Expenses"
            : "Bill uploaded and added to Expenses",
        );
      } else if (data.proposalId) {
        toast.success("Uploaded — staged for review in Documents / Assets");
      } else {
        toast.success("Document processed");
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
        </div>
        <DialogFooter>
          <Button onClick={upload} disabled={!file || busy}>
            {busy ? "Processing…" : "Upload & process"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
