import { extractAgencyAgreementFields } from "../parse-inbound-bill/parse-agency-agreement.ts";
import { handleExtract } from "../_shared/extractHandler.ts";

/** Reads a signed property management agreement for an Agent provider's fee terms to pre-fill.
 * Never writes to the database (see handleExtract). */
Deno.serve(
  handleExtract({
    tag: "extract-agency-agreement",
    subjectPrefix: "Management agreement upload",
    extract: extractAgencyAgreementFields,
  }),
);
