import { extractBillFields } from "../parse-inbound-bill/core-parser.ts";
import { handleExtract } from "../_shared/extractHandler.ts";

/** Reads a bill PDF/photo for the Add Bill / Add Transaction dialogs to pre-fill — same prompt and
 * schema as the email pipeline. Never writes to the database (see handleExtract). */
Deno.serve(handleExtract({ tag: "extract-bill", subjectPrefix: "Bill upload", extract: extractBillFields }));
