import { useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Eye, FileUp, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ACCEPTED_DOCUMENT_TYPES_ACCEPT,
  ACCEPTED_DOCUMENT_TYPES_LABEL,
  openBillDocument,
} from "@/lib/files";
import { LOW_CONFIDENCE_THRESHOLD } from "@/lib/constants";
import type { ExtractStatus } from "@/lib/useAiExtraction";

/**
 * The one upload box for every "upload a document and let the AI read it" dialog: drag-and-drop
 * or choose a file, the attached file with View, "Read with AI again" (prominent after a failed
 * read), and the outcome banners (read OK / nothing found / failed / low confidence). Pair it with
 * useAiExtraction, whose `busy`/`status`/`extract`/`reread` it takes.
 */
export function DocumentDropzone({
  prompt,
  busyText = "Reading document…",
  busy,
  status,
  fileName,
  fileData,
  onFile,
  onReread,
  okText,
  emptyText = "Couldn't find any details in this file — the document is still attached, fill in the fields manually.",
  confidence,
  children,
}: {
  prompt: string;
  busyText?: string;
  busy: boolean;
  status: ExtractStatus;
  fileName?: string;
  fileData?: string;
  onFile: (file: File) => void;
  /** Omit to hide "Read with AI again". */
  onReread?: () => void;
  /** Banner after a successful read; omit when `children` shows its own summary instead. */
  okText?: string;
  emptyText?: string;
  confidence?: number | null;
  /** Extra content under the banners, e.g. a "found in this document" summary. */
  children?: ReactNode;
}) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <div
      className={
        "rounded-md border-2 border-dashed p-6 text-center transition-colors " +
        (dragOver ? "border-primary bg-primary/5" : "")
      }
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f && !busy) onFile(f);
      }}
    >
      <div className="flex flex-col items-center gap-2">
        <FileUp className="h-8 w-8 text-muted-foreground" />
        <div className="text-sm text-muted-foreground">{busy ? busyText : prompt}</div>
        <div className="text-xs text-muted-foreground">Accepts {ACCEPTED_DOCUMENT_TYPES_LABEL}</div>
        <Input
          type="file"
          accept={ACCEPTED_DOCUMENT_TYPES_ACCEPT}
          className="h-8 max-w-[240px] text-xs"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = "";
          }}
        />
      </div>
      {fileName && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded bg-muted/50 px-2 py-1">
          <span className="truncate text-xs">{fileName}</span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 shrink-0 gap-1 text-xs"
            onClick={() => openBillDocument(fileName, fileData)}
          >
            <Eye className="h-3 w-3" /> View
          </Button>
        </div>
      )}
      {fileData && onReread && (
        <Button
          size="sm"
          variant={status === "failed" ? "default" : "outline"}
          className="mt-2 h-7 gap-1 text-xs"
          disabled={busy}
          onClick={onReread}
        >
          <RefreshCw className={"h-3 w-3" + (busy ? " animate-spin" : "")} />
          {busy ? "Reading…" : status === "failed" ? "Try reading again" : "Read with AI again"}
        </Button>
      )}
      {status === "failed" && (
        <Banner tone="amber">
          The AI reader failed, but the document is attached. Try again in a minute, or fill in the
          fields yourself.
        </Banner>
      )}
      {status === "ok" && okText && (
        <Banner tone="green">
          <CheckCircle2 className="h-3 w-3 shrink-0" /> {okText}
        </Banner>
      )}
      {status === "empty" && <Banner tone="amber">{emptyText}</Banner>}
      {status !== "failed" &&
        status !== "empty" &&
        confidence != null &&
        confidence < LOW_CONFIDENCE_THRESHOLD && (
          <Banner tone="amber">
            Low-confidence extraction — double-check every field before saving.
          </Banner>
        )}
      {children}
    </div>
  );
}

function Banner({ tone, children }: { tone: "amber" | "green"; children: ReactNode }) {
  const cls =
    tone === "green"
      ? "border-emerald-300 bg-emerald-50 text-emerald-900"
      : "border-amber-400 bg-amber-50 text-amber-800";
  return (
    <div
      className={`mt-2 flex items-center gap-1 rounded border px-2 py-1 text-left text-xs ${cls}`}
    >
      {tone === "amber" && <AlertTriangle className="h-3 w-3 shrink-0" />}
      {children}
    </div>
  );
}
