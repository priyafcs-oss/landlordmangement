import { useEffect, useState } from "react";
import { FileX, Maximize2, Minimize2, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { base64ToBlobUrl, isImageFileName, mimeForFileName } from "@/lib/files";

/** Shared left-pane document preview for every bill/transaction review surface — renders the
 * actual attached PDF/image via a blob URL (not a raw data: URI, which browsers block from
 * opening in a new tab) so what you see here is exactly what "Download" and "View" open too. */
export function BillDocumentViewer({
  fileName,
  fileData,
  expanded,
  onToggleExpand,
  onRemove,
  emptyLabel = "No document attached",
}: {
  fileName?: string;
  fileData?: string;
  /** Controlled by the parent dialog — when set, "Enlarge" calls this instead of opening this
   * component's own popup, so the parent can grow its whole DialogContent (document pane AND the
   * AI-extracted fields next to it) rather than just this one pane. Omit both this and
   * onToggleExpand to fall back to a self-contained enlarge popup for callers that don't own a
   * resizable dialog. */
  expanded?: boolean;
  onToggleExpand?: () => void;
  /** Shows a small "Remove" button next to Download, for clearing a previously-attached file
   * in place. Omit where there's nothing sensible to clear (e.g. a read-only proposal preview). */
  onRemove?: () => void;
  emptyLabel?: string;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [internalExpanded, setInternalExpanded] = useState(false);
  const controlled = onToggleExpand !== undefined;
  const isExpanded = controlled ? !!expanded : internalExpanded;
  const toggleExpand = onToggleExpand ?? (() => setInternalExpanded((v) => !v));

  useEffect(() => {
    if (!fileData) {
      setBlobUrl(null);
      return;
    }
    const url = base64ToBlobUrl(fileData, mimeForFileName(fileName));
    setBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [fileData, fileName]);

  if (!fileData || !blobUrl) {
    return (
      <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-2 rounded-md border border-dashed text-xs text-muted-foreground">
        <FileX className="h-6 w-6" />
        {emptyLabel}
      </div>
    );
  }

  const body = isImageFileName(fileName) ? (
    <img src={blobUrl} alt={fileName} className="max-h-full w-full flex-1 overflow-auto object-contain" />
  ) : (
    <iframe title={fileName || "Bill document"} src={blobUrl} className="min-h-[400px] flex-1" />
  );

  const viewer = (
    <div className="flex h-full min-h-[300px] flex-col overflow-hidden rounded-md border">
      <div className="flex items-center justify-between border-b bg-muted/40 px-2 py-1 text-xs">
        <span className="truncate">{fileName || "Document"}</span>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={toggleExpand}
            className="text-muted-foreground hover:text-foreground"
            title={isExpanded ? "Shrink" : "Enlarge"}
          >
            {isExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
          <a href={blobUrl} download={fileName} className="text-primary">
            Download
          </a>
          {onRemove && (
            <button type="button" onClick={onRemove} className="text-muted-foreground hover:text-destructive" title="Remove">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      {body}
    </div>
  );

  if (controlled) return viewer;

  // Uncontrolled fallback: no parent dialog to grow, so enlarge into this component's own popup.
  return (
    <>
      {viewer}
      <Dialog open={internalExpanded} onOpenChange={setInternalExpanded}>
        <DialogContent className="flex h-[95vh] max-h-[95vh] w-[95vw] max-w-[95vw] flex-col overflow-hidden p-0">
          <DialogTitle className="sr-only">{fileName || "Document"}</DialogTitle>
          <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2 pr-10 text-sm">
            <span className="truncate">{fileName || "Document"}</span>
            <a href={blobUrl} download={fileName} className="shrink-0 text-primary">
              Download
            </a>
          </div>
          <div className="flex flex-1 flex-col overflow-auto">
            {isImageFileName(fileName) ? (
              <img src={blobUrl} alt={fileName} className="m-auto max-h-full max-w-full object-contain" />
            ) : (
              <iframe title={fileName || "Bill document"} src={blobUrl} className="h-full flex-1" />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
