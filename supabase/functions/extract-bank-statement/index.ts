import { extractBankStatementFields } from "../parse-inbound-bill/parse-bank-statement.ts";
import { handleExtract } from "../_shared/extractHandler.ts";

/** Reads a bank statement PDF/photo into its transaction list for Rental Hub's Bank Feed Import —
 * the same extractor the classify→stage pipeline uses, so the two can't drift. Never writes to the
 * database: matching to tenants and posting stay the human-confirmed client-side flow. */
Deno.serve(
  handleExtract({
    tag: "extract-bank-statement",
    subjectPrefix: "Bank statement upload",
    extract: extractBankStatementFields,
    shape: (parsed) => ({ transactions: parsed.transactions ?? [] }),
  }),
);
