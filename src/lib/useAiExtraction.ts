import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  aiFileProblem,
  invokeExtract,
  storedToExtractFile,
  type ExtractFile,
  type ExtractFunction,
} from "@/lib/aiExtract";
import { readFileAsBase64 } from "@/lib/files";

export type ExtractStatus = "idle" | "ok" | "empty" | "failed";

/**
 * The one "upload → AI reads it → fill the form" flow, used by every upload dialog (bill,
 * transaction, loan, depreciation report, agency agreement, bank statement). Owns: the file
 * type/size check, attaching the file before the read (so it's kept even if the read fails), a
 * stale-result guard (a read still in flight when the dialog closes or another file is dropped is
 * ignored), readable errors, and `reread` so a failed read can be retried without re-uploading.
 *
 * The caller only says what to do with a result: `apply` fills its form and reports whether the
 * read found anything.
 */
export function useAiExtraction<T>(opts: {
  fn: ExtractFunction;
  fallbackError?: string;
  onAttach?: (fileName: string, fileBase64: string) => void;
  apply: (data: T, file: ExtractFile) => { empty: boolean; message?: string };
  emptyMessage?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<ExtractStatus>("idle");
  const generation = useRef(0);

  const run = async (load: () => Promise<ExtractFile>) => {
    const gen = ++generation.current;
    setBusy(true);
    setStatus("idle");
    try {
      const file = await load();
      if (gen !== generation.current) return;
      const data = await invokeExtract<T>(opts.fn, file, opts.fallbackError);
      if (gen !== generation.current) return;
      const outcome = opts.apply(data, file);
      if (outcome.empty) {
        setStatus("empty");
        toast.warning(
          outcome.message ??
            opts.emptyMessage ??
            "Couldn't find any details in this file — fill in the fields manually",
        );
      } else {
        setStatus("ok");
        toast.success(outcome.message ?? "Extracted — review the fields before saving");
      }
    } catch (e) {
      if (gen !== generation.current) return;
      setStatus("failed");
      toast.error(e instanceof Error ? e.message : "Couldn't read this document");
    } finally {
      if (gen === generation.current) setBusy(false);
    }
  };

  /** Reads a newly chosen/dropped file. Ignored while a read is already running. */
  const extract = async (file: File) => {
    if (busy) return;
    const problem = aiFileProblem(file);
    if (problem) return void toast.error(problem);
    await run(async () => {
      const fileBase64 = await readFileAsBase64(file).catch(() => {
        throw new Error(`Couldn't open ${file.name}`);
      });
      opts.onAttach?.(file.name, fileBase64);
      return { fileBase64, fileName: file.name, mimeType: file.type || "application/pdf" };
    });
  };

  /** Reads an already-attached document again (inline base64, or a saved Storage/Drive file). */
  const reread = (fileName: string | undefined, stored: string | undefined) =>
    run(() => storedToExtractFile(fileName, stored));

  /** Forgets any read in flight and clears the status — call when the dialog resets. */
  const reset = () => {
    generation.current++;
    setBusy(false);
    setStatus("idle");
  };

  return { busy, status, extract, reread, reset };
}
