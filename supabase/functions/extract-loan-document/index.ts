import { extractLoanDocumentFields } from "../parse-inbound-bill/parse-loan-document.ts";
import { handleExtract } from "../_shared/extractHandler.ts";

/** Reads a new loan's offer/contract/approval letter for the Add Loan dialog to pre-fill. Never
 * writes to the database (see handleExtract). */
Deno.serve(
  handleExtract({ tag: "extract-loan-document", subjectPrefix: "Loan document upload", extract: extractLoanDocumentFields }),
);
