import { PDFDocument, PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown } from "pdf-lib";
import type { LeaseTemplateConfig, LeaseTemplateField } from "./types";

/**
 * The canonical list of data points we can offer to map onto a lease template — shared by the
 * Settings mapping UI (which field key goes to which real PDF field) and the wizard (which
 * builds a `values` object keyed exactly like this). Keeping one source of truth means the two
 * can never silently drift apart.
 */
export const LEASE_DATA_FIELDS: {
  key: string;
  label: string;
  group: "Agreement" | "Landlord" | "Property" | "Tenant";
}[] = [
  { key: "agreementDate", label: "Date agreement was made", group: "Agreement" },
  { key: "agreementPlace", label: "Place agreement was made", group: "Agreement" },

  { key: "landlordName", label: "Landlord / rental provider name", group: "Landlord" },
  { key: "landlordEmail", label: "Landlord email", group: "Landlord" },
  { key: "landlordPhone", label: "Landlord phone", group: "Landlord" },
  { key: "landlordName2", label: "Co-landlord name (2nd landlord)", group: "Landlord" },
  { key: "landlordContactDetails", label: "Landlord contact details (phone + email combined)", group: "Landlord" },
  { key: "landlordConsentsToElectronicService", label: "Landlord consents to electronic service", group: "Landlord" },

  { key: "propertyAddress", label: "Property address", group: "Property" },
  { key: "hasSwimmingPool", label: "Swimming pool on the premises", group: "Property" },
  { key: "maxOccupants", label: "Maximum occupants", group: "Property" },
  { key: "premisesInclusions", label: "Inclusions", group: "Property" },
  { key: "smokeAlarmType", label: "Smoke alarm type (Hardwired/Battery)", group: "Property" },
  { key: "smokeAlarmBatteryReplaceable", label: "Smoke alarm battery tenant-replaceable", group: "Property" },
  { key: "smokeAlarmBatteryType", label: "Smoke alarm battery type", group: "Property" },
  {
    key: "smokeAlarmBackupBatteryReplaceable",
    label: "Smoke alarm backup battery tenant-replaceable",
    group: "Property",
  },
  { key: "smokeAlarmBackupBatteryType", label: "Smoke alarm backup battery type", group: "Property" },
  {
    key: "strataResponsibleForSmokeAlarms",
    label: "Owners corporation responsible for smoke alarms",
    group: "Property",
  },
  { key: "strataBylawsApply", label: "Strata/community by-laws apply", group: "Property" },
  { key: "electricalRepairsContactName", label: "Electrical repairs — contact name", group: "Property" },
  { key: "electricalRepairsContactPhone", label: "Electrical repairs — phone", group: "Property" },
  { key: "plumbingRepairsContactName", label: "Plumbing repairs — contact name", group: "Property" },
  { key: "plumbingRepairsContactPhone", label: "Plumbing repairs — phone", group: "Property" },
  { key: "otherRepairsContactName", label: "Other repairs — contact name", group: "Property" },
  { key: "otherRepairsContactPhone", label: "Other repairs — phone", group: "Property" },
  { key: "waterUsagePaidSeparately", label: "Tenant pays water usage separately", group: "Property" },
  { key: "electricityEmbeddedNetwork", label: "Electricity from an embedded network", group: "Property" },
  { key: "gasEmbeddedNetwork", label: "Gas from an embedded network", group: "Property" },

  { key: "tenantName", label: "Tenant name", group: "Tenant" },
  { key: "tenantEmail", label: "Tenant email", group: "Tenant" },
  { key: "tenantPhone", label: "Tenant phone", group: "Tenant" },
  { key: "tenantName2", label: "Co-tenant name (2nd tenant)", group: "Tenant" },
  { key: "tenantName3", label: "Co-tenant name (3rd tenant)", group: "Tenant" },
  { key: "tenantNameOthers", label: "Further co-tenant names (4th onward, combined)", group: "Tenant" },
  { key: "tenantContactDetails", label: "Tenant contact details (phone + email combined)", group: "Tenant" },
  { key: "rentAmount", label: "Rent amount", group: "Tenant" },
  { key: "rentFrequency", label: "Rent frequency", group: "Tenant" },
  { key: "bondAmount", label: "Bond amount", group: "Tenant" },
  { key: "bondPaidTo", label: "Bond paid to (Landlord / Agent / NSW Fair Trading)", group: "Tenant" },
  { key: "leaseStart", label: "Lease start date", group: "Tenant" },
  { key: "leaseExpiry", label: "Lease end date", group: "Tenant" },
  { key: "leaseDuration", label: "Lease duration", group: "Tenant" },
  { key: "petsAllowed", label: "Pets allowed", group: "Tenant" },
  { key: "petsDescription", label: "Pet details", group: "Tenant" },
  { key: "additionalLeaseTerms", label: "Additional terms", group: "Tenant" },
  { key: "tenantConsentsToElectronicService", label: "Tenant consents to electronic service", group: "Tenant" },
];

/** Preset battery types the wizard offers for a battery-operated smoke alarm — the two kinds a fresh unit is normally sold with. */
export const SMOKE_ALARM_BATTERY_TYPES = ["9V carbon-zinc/alkaline", "Sealed 10-year lithium"] as const;

/** This app stores dates as ISO (yyyy-mm-dd); printed tenancy agreements conventionally expect dd/mm/yyyy. */
export function toDDMMYYYY(iso: string | undefined): string | undefined {
  if (!iso) return iso;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/**
 * When a template is re-uploaded (e.g. a revised government form), most field *names* usually
 * survive from one revision to the next — only the sections that actually got restructured get
 * renamed. Rather than wiping the whole mapping and making the landlord redo all of it, carry
 * over any entry whose referenced field name(s) still exist in the freshly-inspected field list,
 * and drop only the ones that no longer resolve (so they show up as unmapped for review).
 */
export function carryOverMapping(
  previousMapping: LeaseTemplateConfig["mapping"],
  newFields: LeaseTemplateField[],
): { mapping: LeaseTemplateConfig["mapping"]; carriedCount: number; droppedCount: number } {
  const newFieldNames = new Set(newFields.map((f) => f.name));
  const next: LeaseTemplateConfig["mapping"] = {};
  let droppedCount = 0;

  for (const [ourKey, entry] of Object.entries(previousMapping)) {
    const stillValid = entry.isChoiceGroup
      ? Object.values(entry.valueMap ?? {}).length > 0 &&
        Object.values(entry.valueMap ?? {}).every((name) => newFieldNames.has(name))
      : newFieldNames.has(entry.pdfField);

    if (stillValid) next[ourKey] = entry;
    else droppedCount++;
  }

  return { mapping: next, carriedCount: Object.keys(next).length, droppedCount };
}

/** This app stores uploaded files as full data URLs (FileReader.readAsDataURL output). */
function base64ToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Loads a fillable PDF and lists its real AcroForm fields — the basis of the file-agnostic
 * mapping approach: we never hardcode a field name, we only ever show/use what's actually here.
 */
export async function inspectLeaseTemplate(fileData: string): Promise<LeaseTemplateField[]> {
  const pdfDoc = await PDFDocument.load(base64ToBytes(fileData), { ignoreEncryption: true });
  const form = pdfDoc.getForm();
  const fields: LeaseTemplateField[] = [];

  for (const field of form.getFields()) {
    const name = field.getName();
    if (field instanceof PDFTextField) {
      fields.push({ name, type: "text" });
    } else if (field instanceof PDFCheckBox) {
      fields.push({ name, type: "checkbox" });
    } else if (field instanceof PDFRadioGroup) {
      fields.push({ name, type: "radio", options: field.getOptions() });
    } else if (field instanceof PDFDropdown) {
      fields.push({ name, type: "dropdown", options: field.getOptions() });
    }
    // Buttons/signature/list-box fields are skipped — not meaningful targets for data mapping.
  }

  return fields;
}

/**
 * Fills the stored template from `values` (keyed by our own field keys, e.g. "maxOccupants"),
 * via the landlord's saved mapping to that PDF's real field names. Unmapped or empty values are
 * skipped — this works usefully even before every field has been wired up. Does not flatten the
 * form, so the result stays a live fillable PDF the landlord/tenant can still adjust.
 */
export async function fillLeaseTemplate(
  template: LeaseTemplateConfig,
  values: Record<string, string | boolean | undefined>,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(base64ToBytes(template.fileData), { ignoreEncryption: true });
  const form = pdfDoc.getForm();

  const resolveOption = (mapping: { valueMap?: Record<string, string> }, v: string | boolean) => {
    const key = typeof v === "boolean" ? (v ? "true" : "false") : v;
    return mapping.valueMap?.[key] ?? key;
  };

  for (const [ourKey, mapping] of Object.entries(template.mapping)) {
    const rawValue = values[ourKey];
    if (rawValue === undefined || rawValue === null || rawValue === "") continue;

    if (mapping.isChoiceGroup) {
      const key = typeof rawValue === "boolean" ? (rawValue ? "true" : "false") : rawValue;
      const targetFieldName = mapping.valueMap?.[key];
      if (!targetFieldName) continue; // this value has no checkbox assigned in the group — leave all unchecked
      try {
        const targetField = form.getField(targetFieldName);
        if (targetField instanceof PDFCheckBox) targetField.check();
      } catch (e) {
        console.warn(`[leaseTemplate] failed to check "${targetFieldName}" (choice group for "${ourKey}")`, e);
      }
      continue;
    }

    let field;
    try {
      field = form.getField(mapping.pdfField);
    } catch {
      continue; // mapped field no longer exists (e.g. the template was re-uploaded/revised)
    }

    try {
      if (field instanceof PDFTextField) {
        field.setText(String(rawValue));
      } else if (field instanceof PDFCheckBox) {
        const shouldCheck = typeof rawValue === "boolean" ? rawValue : rawValue === "true" || rawValue === "Yes";
        if (shouldCheck) field.check();
        else field.uncheck();
      } else if (field instanceof PDFRadioGroup || field instanceof PDFDropdown) {
        field.select(resolveOption(mapping, rawValue));
      }
    } catch (e) {
      console.warn(`[leaseTemplate] failed to fill "${mapping.pdfField}" (for "${ourKey}")`, e);
    }
  }

  return pdfDoc.save();
}

/**
 * Appends every page of `extraFileData` (a stored data-URL PDF, e.g. the Tenant Information
 * Statement) after `baseBytes` (the just-filled agreement), returning one combined PDF. Used so
 * the generated document is a single file the landlord can hand the tenant, matching how the
 * Tenant Information Statement is required to accompany every NSW tenancy agreement.
 */
export async function appendPdf(baseBytes: Uint8Array, extraFileData: string): Promise<Uint8Array> {
  const baseDoc = await PDFDocument.load(baseBytes, { ignoreEncryption: true });
  const extraDoc = await PDFDocument.load(base64ToBytes(extraFileData), { ignoreEncryption: true });
  const copiedPages = await baseDoc.copyPages(extraDoc, extraDoc.getPageIndices());
  for (const page of copiedPages) baseDoc.addPage(page);
  return baseDoc.save();
}
