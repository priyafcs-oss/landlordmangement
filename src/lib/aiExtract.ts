import { supabase } from "@/integrations/supabase/client";
import {
  edgeFunctionErrorMessage,
  formatFileSize,
  isSupportedDocumentFile,
  MAX_AI_UPLOAD_BYTES,
  mimeForFileName,
  readFileAsBase64,
  resolveDocumentBlob,
} from "@/lib/files";

/** The stateless AI readers (supabase/functions/extract-*). */
export type ExtractFunction =
  | "extract-bill"
  | "extract-loan-document"
  | "extract-depreciation-report"
  | "extract-agency-agreement"
  | "extract-bank-statement";

export interface ExtractFile {
  fileBase64: string;
  fileName: string;
  mimeType: string;
}

/** Why a file can't go to the AI reader (wrong type, too big), or null when it can. */
export function aiFileProblem(file: File): string | null {
  if (!isSupportedDocumentFile(file)) {
    return `${file.name} isn't a PDF or image — the AI reader (and the preview pane) only support those. Try exporting/saving it as a PDF first.`;
  }
  if (file.size > MAX_AI_UPLOAD_BYTES) {
    return `This file is ${formatFileSize(file.size)} — the AI reader can only handle files up to ${formatFileSize(MAX_AI_UPLOAD_BYTES)}. Try a lower-resolution scan, or split it into smaller files.`;
  }
  return null;
}

/** Runs an AI reader on a document. Throws a readable message on failure (e.g. "Google's AI
 * reader is overloaded right now…"), never Gemini's raw JSON error. */
export async function invokeExtract<T>(
  fn: ExtractFunction,
  file: ExtractFile,
  fallbackError = "Couldn't read this document",
): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T & { ok?: boolean; error?: string }>(
    fn,
    { body: file },
  );
  if (error) throw new Error(await edgeFunctionErrorMessage(error));
  if (!data?.ok) throw new Error(data?.error || fallbackError);
  return data;
}

/** The same, for a document already attached — inline base64 (a fresh upload) or saved to
 * Storage/Drive (a saved record) — for "read it again" after a failed or outdated read. */
export async function storedToExtractFile(
  fileName: string | undefined,
  stored: string | undefined,
): Promise<ExtractFile> {
  const blob = await resolveDocumentBlob(fileName, stored);
  if (!blob) throw new Error("Couldn't load the attached document");
  const name = fileName || "document.pdf";
  const mimeType = blob.type || mimeForFileName(name);
  return {
    fileBase64: await readFileAsBase64(new File([blob], name, { type: mimeType })),
    fileName: name,
    mimeType,
  };
}
