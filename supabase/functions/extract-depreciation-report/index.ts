import { extractDepreciationReportFields } from "../parse-inbound-bill/parse-depreciation-report.ts";
import { handleExtract } from "../_shared/extractHandler.ts";

/** Reads a quantity surveyor's depreciation report for the Add Depreciation Report dialog to
 * pre-fill. Never writes to the database (see handleExtract). */
Deno.serve(
  handleExtract({
    tag: "extract-depreciation-report",
    subjectPrefix: "Depreciation report upload",
    extract: extractDepreciationReportFields,
  }),
);
