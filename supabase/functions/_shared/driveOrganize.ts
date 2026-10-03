import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { createDriveFolder, type DriveItem, GDRIVE_PREFIX, listDriveTree, moveDriveFile, renameDriveItem, trashDriveItem } from "./googleDrive.ts";

/** Every table whose rows can hold a stored file — mirrors src/lib/db.ts's TABLES (minus the
 * file-less `singleton`). */
export const FILE_TABLES = [
  "properties",
  "tenants",
  "ledger_entries",
  "tenant_invoices",
  "loans",
  "expenses",
  "inspections",
  "rent_changes",
  "lease_history",
  "maintenance_requests",
  "property_bills",
  "ai_intake_proposals",
  "email_inbox_log",
  "providers",
  "provider_agreements",
  "provider_properties",
  "entities",
  "assets",
  "gold_details",
  "etf_details",
  "depreciation_items",
  "valuation_snapshots",
  "loan_balance_snapshots",
  "loan_statements",
  "buffers",
  "bank_accounts",
  "insurance_policies",
  "maintenance_items",
  "compliance_certificates",
  "property_notes",
  "provider_documents",
  "app_settings",
];

/**
 * Folder layout under the owner's root:
 *
 *   <property>/FY 2025-2026/Bills|Rent Statements|Expenses|...   year-bound documents
 *   <property>/Purchase & Setup|Leases & Tenants|Loans|...        documents that span years
 *   General/...                                                   same shape, no single property
 *
 * `yearly` categories go under an FY folder when the row has a document date (see DATE_FIELDS);
 * without one they fall back to sitting directly under the property like a non-yearly one.
 *
 * Listed in priority order — one file is often referenced from several rows (an agent statement
 * from every ledger entry AND the fee expense it produced; a bill from its AI intake proposal AND
 * the bill row), and a Drive file can only sit in one folder, so the earliest category any of its
 * rows maps to wins. "Inbox" (still-unreviewed AI intake) is last, so a document moves out of it
 * the moment it's approved into a real record.
 */
const CATEGORIES: { name: string; yearly: boolean; tables: string[] }[] = [
  { name: "Bills", yearly: true, tables: ["property_bills"] },
  { name: "Rent Statements", yearly: true, tables: ["ledger_entries"] },
  { name: "Loan Statements", yearly: true, tables: ["loan_statements", "loan_balance_snapshots"] },
  { name: "Insurance", yearly: true, tables: ["insurance_policies"] },
  { name: "Compliance", yearly: true, tables: ["compliance_certificates"] },
  { name: "Tenancy", yearly: true, tables: ["rent_changes", "inspections", "tenant_invoices"] },
  { name: "Maintenance", yearly: true, tables: ["maintenance_requests", "maintenance_items"] },
  { name: "Valuations", yearly: true, tables: ["valuation_snapshots"] },
  { name: "Bank Statements", yearly: true, tables: ["bank_accounts", "buffers"] },
  { name: "Expenses", yearly: true, tables: ["expenses"] },
  { name: "Leases & Tenants", yearly: false, tables: ["tenants", "lease_history"] },
  { name: "Loans", yearly: false, tables: ["loans"] },
  { name: "Agents & Providers", yearly: false, tables: ["providers", "provider_agreements", "provider_properties", "provider_documents"] },
  { name: "Purchase & Setup", yearly: false, tables: ["properties", "assets", "depreciation_items", "gold_details", "etf_details"] },
  { name: "Notes", yearly: false, tables: ["property_notes"] },
  { name: "Other", yearly: false, tables: ["entities", "app_settings"] },
  { name: "Inbox", yearly: false, tables: ["ai_intake_proposals", "email_inbox_log"] },
];
const CATEGORY_RANK = new Map<string, number>();
const YEARLY = new Set<string>();
const TABLE_CATEGORY = new Map<string, string>();
CATEGORIES.forEach(({ name, yearly, tables }, i) => {
  CATEGORY_RANK.set(name, i);
  if (yearly) YEARLY.add(name);
  for (const t of tables) TABLE_CATEGORY.set(t, name);
});
/**
 * The document's own date, per table, in preference order — decides its financial-year folder.
 * Deliberately never `created_at`: that's when it was uploaded, which for a back-filed statement
 * can be a different FY entirely. Only yearly categories' tables need one.
 */
const DATE_FIELDS: Record<string, string[]> = {
  property_bills: ["issueDate", "periodEnd", "dueDate", "paidDate"],
  ledger_entries: ["date"],
  expenses: ["date", "paidDate", "periodEnd"],
  loan_statements: ["periodEnd", "periodStart"],
  loan_balance_snapshots: ["date"],
  insurance_policies: ["coverStart"],
  compliance_certificates: ["issueDate"],
  rent_changes: ["changeDate"],
  inspections: ["date"],
  tenant_invoices: ["dateIssued", "dueDate"],
  maintenance_requests: ["createdAt"],
  maintenance_items: ["completedDate", "scheduledDate", "startDate"],
  valuation_snapshots: ["date"],
};

/** Australian FY (1 July – 30 June), labelled the same "2025-2026" way as the app's own FY
 * pickers (src/lib/calculations.ts's ausFinancialYear). Only trusts an ISO-shaped date. */
function financialYear(value: unknown): string | undefined {
  const m = typeof value === "string" ? /^(\d{4})-(\d{2})-\d{2}/.exec(value) : null;
  if (!m) return undefined;
  const year = Number(m[1]);
  return Number(m[2]) >= 7 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

function rowFinancialYear(table: string, row: Record<string, unknown>): string | undefined {
  for (const field of DATE_FIELDS[table] ?? []) {
    const fy = financialYear(row[field]);
    if (fy) return fy;
  }
  return undefined;
}

const INBOX = "Inbox";
const GENERAL_FOLDER = "General";
/** Tags a property's folder with its id, so renaming the property renames the folder instead of
 * starting a new one and stranding the old one empty. */
const PROPERTY_FOLDER_KEY = "lpid";

type Row = Record<string, unknown>;

function collectDriveIds(value: unknown, out: Set<string>) {
  if (typeof value === "string") {
    if (value.startsWith(GDRIVE_PREFIX)) out.add(value.slice(GDRIVE_PREFIX.length));
  } else if (Array.isArray(value)) {
    for (const v of value) collectDriveIds(v, out);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value as Row)) collectDriveIds(v, out);
  }
}

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

/** `ownerId` set: service-role caller, filter explicitly. Null: a user-session client, where RLS
 * alone scopes every read (matters for an aliased account whose id isn't the rows' owner_id). */
async function loadAllRows(supabase: SupabaseClient, ownerId: string | null): Promise<Map<string, Row[]> | null> {
  const PAGE = 500;
  const result = new Map<string, Row[]>();
  const loaded = await Promise.all(
    FILE_TABLES.map(async (table) => {
      const rows: Row[] = [];
      for (let offset = 0; ; offset += PAGE) {
        let query = supabase.from(table).select("*");
        if (ownerId) query = query.eq("owner_id", ownerId);
        const { data, error } = await query.range(offset, offset + PAGE - 1);
        if (error) {
          console.error("[driveOrganize] failed to read", table, error.message);
          return false;
        }
        rows.push(...((data ?? []) as Row[]));
        if (!data || data.length < PAGE) break;
      }
      result.set(table, rows);
      return true;
    }),
  );
  return loaded.every(Boolean) ? result : null;
}

export interface OrganizeResult {
  ok: boolean;
  referencedFiles: number;
  moved: number;
  alreadyFiled: number;
  foldersCreated: number;
  emptyFoldersRemoved: number;
  failed: number;
  error?: string;
}

/**
 * Files every Drive document a row references into the CATEGORIES layout under the owner's root
 * folder. Idempotent: anything already in its right folder is left alone, so it's cheap to run after every save. Only ever moves files — ids
 * don't change on a move, so no row is rewritten — and never touches a file no row references
 * (it may be a just-uploaded one whose row hasn't been saved yet).
 */
export async function organizeDrive(
  supabase: SupabaseClient,
  ownerId: string | null,
  accessToken: string,
  rootFolderId: string,
): Promise<OrganizeResult> {
  const empty = { referencedFiles: 0, moved: 0, alreadyFiled: 0, foldersCreated: 0, emptyFoldersRemoved: 0, failed: 0 };
  const [tables, tree] = await Promise.all([loadAllRows(supabase, ownerId), listDriveTree(accessToken, rootFolderId)]);
  if (!tables) return { ok: false, ...empty, error: "Couldn't read every table" };
  if (!tree) return { ok: false, ...empty, error: "Couldn't list the Drive folder" };

  const propertyName = new Map<string, string>();
  for (const p of tables.get("properties") ?? []) {
    propertyName.set(p.id as string, str(p.alias) ?? str(p.address) ?? `Property ${String(p.id).slice(0, 8)}`);
  }
  const tenantProperty = new Map((tables.get("tenants") ?? []).map((t) => [t.id as string, str(t.propertyId)]));
  const loanProperty = new Map((tables.get("loans") ?? []).map((l) => [l.id as string, str(l.propertyId)]));

  const rowProperty = (table: string, row: Row): string | undefined => {
    if (table === "properties") return row.id as string;
    const tenantId = str(row.tenantId) ?? str(row.matchedTenantId);
    const loanId = str(row.loanId) ?? str(row.matchedLoanId);
    const id =
      str(row.propertyId) ??
      str(row.linkedPropertyId) ??
      (tenantId ? tenantProperty.get(tenantId) : undefined) ??
      (loanId ? loanProperty.get(loanId) : undefined);
    return id && propertyName.has(id) ? id : undefined;
  };

  // fileId -> every (category, property, FY) a referencing row implies
  const refs = new Map<string, { category: string; propertyId?: string; fy?: string }[]>();
  for (const [table, rows] of tables) {
    const category = TABLE_CATEGORY.get(table) ?? "Other";
    for (const row of rows) {
      const ids = new Set<string>();
      collectDriveIds(row, ids);
      if (ids.size === 0) continue;
      const propertyId = rowProperty(table, row);
      const fy = YEARLY.has(category) ? rowFinancialYear(table, row) : undefined;
      for (const id of ids) {
        const list = refs.get(id) ?? [];
        list.push({ category, propertyId, fy });
        refs.set(id, list);
      }
    }
  }

  // Folder lookup by (parent, name), plus property folders by their id tag.
  const childFolder = new Map<string, string>();
  const folderParent = new Map<string, string>();
  const propertyFolder = new Map<string, DriveItem>();
  for (const f of tree.folders.values()) {
    const parent = f.parents?.[0];
    if (parent && f.name) childFolder.set(`${parent}/${f.name}`, f.id);
    if (parent) folderParent.set(f.id, parent);
    const tagged = f.appProperties?.[PROPERTY_FOLDER_KEY];
    if (tagged && parent === rootFolderId) propertyFolder.set(tagged, f);
  }

  let foldersCreated = 0;
  const pendingFolders = new Map<string, Promise<string | null>>();
  const ensureFolder = (parentId: string, name: string, tag?: Record<string, string>): Promise<string | null> => {
    const key = `${parentId}/${name}`;
    const existing = childFolder.get(key);
    if (existing) return Promise.resolve(existing);
    let pending = pendingFolders.get(key);
    if (!pending) {
      pending = createDriveFolder(accessToken, name, parentId, tag).then((id) => {
        if (id) {
          foldersCreated++;
          childFolder.set(key, id);
          folderParent.set(id, parentId);
        }
        return id;
      });
      pendingFolders.set(key, pending);
    }
    return pending;
  };

  // Two properties sharing a name would otherwise merge into one folder.
  const nameCount = new Map<string, number>();
  for (const name of propertyName.values()) nameCount.set(name, (nameCount.get(name) ?? 0) + 1);
  const folderNameFor = (propertyId: string) => {
    const name = propertyName.get(propertyId)!;
    return (nameCount.get(name) ?? 0) > 1 ? `${name} (${propertyId.slice(0, 4)})` : name;
  };

  const ensurePropertyFolder = async (propertyId: string): Promise<string | null> => {
    const wanted = folderNameFor(propertyId);
    const tagged = propertyFolder.get(propertyId);
    if (tagged) {
      if (tagged.name !== wanted && (await renameDriveItem(accessToken, tagged.id, wanted))) {
        childFolder.delete(`${rootFolderId}/${tagged.name}`);
        childFolder.set(`${rootFolderId}/${wanted}`, tagged.id);
        tagged.name = wanted;
      }
      return tagged.id;
    }
    const id = await ensureFolder(rootFolderId, wanted, { [PROPERTY_FOLDER_KEY]: propertyId });
    if (id) propertyFolder.set(propertyId, { id, name: wanted, parents: [rootFolderId] });
    return id;
  };

  const filesById = new Map(tree.files.map((f) => [f.id, f]));
  let moved = 0;
  let alreadyFiled = 0;
  let failed = 0;

  // Sequential on purpose: folder creation is cached per run, but parallel moves would hammer
  // Drive's per-user rate limit for no real gain at this scale.
  for (const [fileId, fileRefs] of refs) {
    const file = filesById.get(fileId);
    if (!file) continue; // trashed, or outside the root folder — not ours to move

    const real = fileRefs.filter((r) => r.category !== INBOX);
    const chosen = real.length ? real : fileRefs;
    const category = chosen.reduce((best, r) => (CATEGORY_RANK.get(r.category)! < CATEGORY_RANK.get(best)! ? r.category : best), chosen[0].category);
    const properties = new Set(chosen.map((r) => r.propertyId).filter((p): p is string => !!p));
    const propertyId = properties.size === 1 ? [...properties][0] : undefined;

    // Most common FY among the rows that decided the category (a statement straddling 30 June can
    // be referenced from both sides of it); ties go to the later year.
    const fyVotes = new Map<string, number>();
    for (const r of chosen) if (r.category === category && r.fy) fyVotes.set(r.fy, (fyVotes.get(r.fy) ?? 0) + 1);
    const fy = [...fyVotes].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0]?.[0];

    const baseId = propertyId ? await ensurePropertyFolder(propertyId) : await ensureFolder(rootFolderId, GENERAL_FOLDER);
    const parentId = baseId && fy ? await ensureFolder(baseId, `FY ${fy}`) : baseId;
    const targetId = parentId ? await ensureFolder(parentId, category) : null;
    if (!targetId) {
      failed++;
      continue;
    }
    const parents = file.parents ?? [];
    if (parents.length === 1 && parents[0] === targetId) {
      alreadyFiled++;
      continue;
    }
    if (await moveDriveFile(accessToken, fileId, parents, targetId)) {
      moved++;
      file.parents = [targetId];
    } else {
      failed++;
    }
  }

  // A re-file or a layout change can leave folders with nothing in them. Any folder with a file
  // anywhere beneath it stays — including files no row references, which are never moved — and so
  // do property folders (they carry the id tag a later rename relies on). Only the topmost folder
  // of each empty branch is trashed; its children go with it.
  const nonEmpty = new Set<string>();
  for (const f of tree.files) {
    for (let id = f.parents?.[0]; id && !nonEmpty.has(id); id = folderParent.get(id)) nonEmpty.add(id);
  }
  const keep = new Set([rootFolderId, ...[...propertyFolder.values()].map((f) => f.id)]);
  let emptyFoldersRemoved = 0;
  for (const [id, parent] of folderParent) {
    if (nonEmpty.has(id) || keep.has(id)) continue;
    if (!nonEmpty.has(parent) && !keep.has(parent)) continue; // an empty ancestor is trashed instead
    if (await trashDriveItem(accessToken, id)) emptyFoldersRemoved++;
  }

  return { ok: failed === 0, referencedFiles: refs.size, moved, alreadyFiled, foldersCreated, emptyFoldersRemoved, failed };
}
