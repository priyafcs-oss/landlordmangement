import { useEffect, useState } from "react";
import { FileX, Maximize2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { base64ToBlobUrl, isImageFileName, mimeForFileName } from "@/lib/files";

/** Shared left-pane document preview for Add Bill and the bill detail view — renders the actual
 * attached PDF/image via a blob URL (not a raw data: URI, which browsers block from opening in a
 * new tab) so what you see here is exactly what "Download" and "View" open too. */
export function BillDocumentViewer({ fileName, fileData }: { fileName?: string; fileData?: string }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

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
        No document attached
      </div>
    );
  }

  const body = isImageFileName(fileName) ? (
    <img src={blobUrl} alt={fileName} className="max-h-full w-full flex-1 overflow-auto object-contain" />
  ) : (
    <iframe title={fileName || "Bill document"} src={blobUrl} className="min-h-[400px] flex-1" />
  );

  return (
    <div className="flex h-full min-h-[300px] flex-col overflow-hidden rounded-md border">
      <div className="flex items-center justify-between border-b bg-muted/40 px-2 py-1 text-xs">
        <span className="truncate">{fileName || "Document"}</span>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="text-muted-foreground hover:text-foreground"
            title="Enlarge"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
          <a href={blobUrl} download={fileName} className="text-primary">
            Download
          </a>
        </div>
      </div>
      {body}
      <Dialog open={expanded} onOpenChange={setExpanded}>
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
    </div>
  );
}
