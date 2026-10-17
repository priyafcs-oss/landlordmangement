import { supabase } from "@/integrations/supabase/client";
import {
  edgeFunctionErrorMessage,
  mimeForFileName,
  readFileAsBase64,
  resolveDocumentBlob,
} from "@/lib/files";
import type { ExtractBillResult } from "@/lib/types";

/** Runs the AI bill reader (extract-bill) on a document. Throws a readable message on failure —
 * e.g. "Google's AI reader is overloaded right now…" — never Gemini's raw JSON error. */
export async function extractBill(
  fileBase64: string,
  fileName: string,
  mimeType: string,
): Promise<ExtractBillResult> {
  const { data, error } = await supabase.functions.invoke<ExtractBillResult>("extract-bill", {
    body: { fileBase64, fileName, mimeType },
  });
  if (error) throw new Error(await edgeFunctionErrorMessage(error));
  if (!data?.ok) throw new Error(data?.error || "Couldn't read this bill");
  return data;
}

/** Same, for a document that's already attached — whether still inline base64 (a fresh upload) or
 * already saved to Storage/Drive (a saved bill, or a proposal's file). Used by "Read with AI"
 * retries after a failed first read. */
export async function extractBillFromStored(
  fileName: string | undefined,
  stored: string | undefined,
): Promise<ExtractBillResult> {
  const blob = await resolveDocumentBlob(fileName, stored);
  if (!blob) throw new Error("Couldn't load the attached document");
  const name = fileName || "bill.pdf";
  const mimeType = blob.type || mimeForFileName(name);
  const base64 = await readFileAsBase64(new File([blob], name, { type: mimeType }));
  return extractBill(base64, name, mimeType);
}
