# Landlord OS — Architecture

> A note on scope: this document describes the system as it actually exists in this repository.
> An earlier draft of this brief assumed a Next.js App Router architecture with API routes,
> `transactions`/`documents`/`sources` tables, and server-side pagination — none of those match
> this codebase, so the corrections are called out inline rather than silently overwritten.

## 1. Executive overview

Landlord OS is a multi-tenant property/document/transaction-management app for self-managing
landlords. Each Supabase Auth account gets its own completely separate portfolio — properties,
tenants, leases, bills, loans, expenses, documents — with no cross-account visibility.

Core architectural principles:

- **One client-side data-access layer.** Every table read/write in the browser goes through a
  single generic module (`src/lib/db.ts`), keyed by a `TABLES` map — no per-table client logic,
  no client-side owner filtering. Isolation lives in the database (Postgres RLS), not the app.
- **Egress-conscious file handling.** File bytes (photos, receipts, leases, statements) are never
  embedded in a table row loaded on every page view — they're stored out-of-line and fetched only
  when a document is actually opened. This was a deliberate fix for a real Supabase egress
  overage; see §4 and §5.
- **AI intake is a staging pipeline, not a direct write.** Every inbound document — emailed,
  uploaded, or link-fetched — goes through classification and extraction, then lands in a review
  queue (`ai_intake_proposals`). Nothing is auto-posted to a real ledger/bill table without a
  landlord's explicit approval, after an incident where an auto-posted item went through
  unreviewed.
- **Server code degrades gracefully, never silently.** AI calls, storage writes, and inbound-email
  processing all have explicit timeout/retry/fallback paths, and a failure at any stage still logs
  a record of what happened rather than vanishing without a trace.

## 2. Tech stack blueprint

| Layer | What's actually used | Note |
|---|---|---|
| Frontend framework | **TanStack Start** (file-based routes in `src/routes/`) on **React 19**, via Vite | Not Next.js — there is no `app/` directory, no Next.js API routes, no Next.js middleware anywhere in this repo. |
| Styling / components | Tailwind CSS v4, shadcn/ui (`src/components/ui/`) | |
| Language | TypeScript throughout (client and edge functions) | `strict: true` |
| Build | Vite (via a wrapped preset, `@lovable.dev/vite-tanstack-config`), Nitro for the server entry | |
| Database | Supabase **Postgres** | ~31 tables, all RLS-scoped; see §3 |
| Auth | Supabase Auth | Self-service sign-up, server-side login lockout (5 failed attempts / 5 min, via `SECURITY DEFINER` RPCs — not client-side, can't be bypassed by clearing storage) |
| Authorization | Postgres **Row-Level Security** | One policy shape repeated per table: `owner_id = auth.uid()` |
| File storage | **Dual-backend**: a private Supabase Storage bucket (`documents`), and — as of the most recent migration — **per-landlord Google Drive** (OAuth, scope `drive.file` only) | Each landlord who connects Drive gets their own storage they control; a landlord who hasn't connected yet keeps using the shared bucket. Both backends are live simultaneously during the per-owner rollout — see §5. |
| AI ingestion | Resend inbound-email webhook → **Supabase Edge Function** (Deno) → **Gemini API**, called via raw `fetch()` (no SDK) → strict-JSON structured output | Not a Next.js API route — this pipeline runs on Deno, deployed with `supabase functions deploy`, separately from the frontend's own deploy. |
| Deploy | Supabase CLI (DB + functions) + GitHub + Vercel (frontend, auto-deploy on push to `main`) | |

### 2a. The AI ingestion pipeline in detail

```
Resend (inbound email)
  │  Svix-signed webhook (svix-id / svix-timestamp / svix-signature headers)
  ▼
supabase/functions/parse-inbound-bill/index.ts   (Deno, Deno.serve)
  │  1. Verify signature: new Webhook(secret).verify(...) — real `svix` npm package, not manual HMAC
  │  2. Fetch full email + attachment bytes from Resend's REST API
  │  3. One "job" per real attachment (or one text-only job if none)
  ▼
router.ts → classify.ts → Gemini (classification: bill / lease_agreement / rent_statement / ...)
  │
  ▼
parse-bill.ts / parse-lease.ts / parse-ledger.ts / ... (per document type)
  │  Gemini extraction (strict JSON schema, temperature 0) → validate → fuzzy-match property/vendor
  ▼
ai_intake_proposals  (status: "pending")  ◄── staging table, NOT the final ledger
  │
  │  landlord reviews in-app, clicks Approve
  ▼
property_bills / tenants / expenses / ... (the real, final row)
```

Also reachable the same way: a landlord manually uploading a file (`upload-document` function) or
re-classifying an unclassified document (`reparse-document`) — both dispatch into the same
`router.ts` → per-type parser chain, so there's exactly one extraction pipeline regardless of how
a document entered the system.

**Gemini call shape** (`supabase/functions/parse-inbound-bill/gemini.ts`): plain `fetch()` to
`generativelanguage.googleapis.com`, `responseMimeType: "application/json"` with a caller-supplied
JSON schema, `temperature: 0` for deterministic extraction. A 45s timeout via `AbortController`;
up to 2 same-model retries on a timeout/network error/5xx; falls through to a secondary model
candidate on 404 (model retired) or 429 (quota exhausted); any other 4xx fails immediately as a
real bug, not a transient condition.

## 3. Database entity-relationship model

Every table below has an `owner_id uuid references auth.users(id)` (default
`COALESCE(auth.uid(), <first-created auth user>)`) and one RLS policy:
`FOR ALL TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid())`.
**Correction to the brief**: there is no single `transactions`, `documents`, or `sources` table —
files are stored inline per-owning-table (a `fileData`/`*FileData` column paired with a
`fileName`/`*FileName` column, holding a `"storage:<path>"` or `"gdrive:<fileId>"` marker, never
raw bytes at rest in a hot-loaded row), and each financial-event type has its own table.

### Core portfolio

| Table | Key columns | Purpose |
|---|---|---|
| `properties` | `id` PK, `entityId` FK→`entities`, `assetId` FK→`assets` | The property itself — address, purchase/sale figures, insurance, compliance dates, loan summary fields, photos. |
| `tenants` | `id` PK, `propertyId` FK→`properties` | A tenancy — rent, lease dates, bond, lease/ID/bond-transfer documents. |
| `ledger_entries` | `id` PK, `tenantId` FK→`tenants`, `linkedInvoiceId` FK→`tenant_invoices` | Rent ledger — debits/credits per tenant. |
| `tenant_invoices` | `id` PK, referenced by `ledger_entries.linkedInvoiceId` | Invoices raised against a tenant. |
| `rent_changes`, `lease_history` | `id` PK | Audit trail of rent/lease changes over time. |
| `maintenance_requests`, `maintenance_items` | `id` PK, `propertyId` FK | Tenant-submitted requests (`maintenance_requests` — the only table reachable by an **anonymous, unauthenticated** submitter, see §4) and landlord-tracked maintenance work items. |

### Financials

| Table | Key columns | Purpose |
|---|---|---|
| `property_bills` | `id` PK, `propertyId`/`providerId`/`assetId` FK, `linkedExpenseId` FK→`expenses` | A recurring or one-off bill — the table the AI bill pipeline's approved output ultimately lands in (never written directly by the edge function itself — see §2a). |
| `expenses` | `id` PK, `propertyId`/`providerId`/`assetId`/`tenantId` FK | Realized expense/income transactions — the closest real equivalent to a generic "transactions" table. |
| `loans`, `loan_balance_snapshots`, `loan_statements` | `id` PK, `propertyId`/`assetId` FK | Loan terms, balance history, statement records. |
| `buffers` | `id` PK, `scopeId` (polymorphic) | Cash-reserve targets per property/entity/portfolio scope. |
| `bank_accounts`, `insurance_policies`, `compliance_certificates` | `id` PK, `propertyId` FK | Supporting financial/compliance records. |

### AI intake & audit trail

| Table | Key columns | Purpose |
|---|---|---|
| `ai_intake_proposals` | `id` PK, `propertyId`/`matchedTenantId`/`matchedLoanId` FK (all nullable), `payload jsonb`, `status` | **The staging table** — every AI-classified document lands here first, regardless of type (`kind` discriminates: bill/lease/rent_statement/...). Only a landlord's explicit approval promotes it into a real table. |
| `email_inbox_log` | `id` PK, `billId`/`proposalId` FK (nullable) | One row per (email, attachment) pair processed by the webhook, **regardless of outcome** — success, staged, skipped, or failed. This is the operational audit trail; `ai_intake_proposals` only ever gets a row on an actual match. |

### Providers & entities

| Table | Key columns | Purpose |
|---|---|---|
| `providers` | `id` PK, `propertyId` FK (nullable) | Vendors/agents/tradespeople — contact info, fee structure, portal credentials (`passwordNote` is a free-text hint; a real encrypted password uses Supabase Vault via `providers."portalPasswordSecretId"`, not a plain column). |
| `provider_agreements`, `provider_properties`, `provider_documents` | `id` PK, `providerId` FK | Agency agreements, provider↔property links, provider-held documents (compliance certs, contracts). |
| `entities` | `id` PK | Legal ownership entities (individual, trust, company) — `owners jsonb`. |

### Assets & investments (non-property)

| Table | Key columns | Purpose |
|---|---|---|
| `assets` | `id` PK, `linkedPropertyId`/`ownerEntityId` FK | Any owned asset — a depreciable item, a gold holding, an ETF position. |
| `gold_details`, `etf_details` | `assetId` PK+FK (1:1 with `assets`) | Type-specific detail, split out from the generic `assets` row. |
| `depreciation_items` | `id` PK, `assetId` FK, `reportId` (groups items from the same QS report) | Tax depreciation schedule line items. |
| `valuation_snapshots` | `id` PK | Point-in-time valuation history. |

### Settings & ops

| Table | Key columns | Purpose |
|---|---|---|
| `app_settings` | `id` PK (== `owner_id`) | Per-landlord settings — profile, lease template config, AI config. One row per owner, not a global singleton. |
| `file_access_log` | `id` PK | Logs a genuine (non-cached) file download, for the Settings "Storage & File Usage" monitor. |
| `google_drive_connections` | `owner_id` PK+FK→`auth.users`, `refresh_token_secret_id` → Vault | Per-landlord Drive OAuth connection — the refresh token itself is never in this table, only a pointer into `vault.secrets`, decryptable only via `SECURITY DEFINER` RPCs. |
| `login_attempts` (server-side only, no client table entry) | keyed by email | Backs the login-lockout RPCs. |

### Views

- **`properties_public`** — a `SECURITY DEFINER` view exposing only address/alias/tenant-code,
  readable by `anon`. Powers the one genuinely public, unauthenticated surface in the app: the
  maintenance-request form (§4).

## 4. Security & privacy safeguards

This app handles land tax notices, council rate bills, bank/loan statements, and tenant PII
(bond details, ID documents) — every safeguard below exists because of that, not as generic
boilerplate.

- **Row-Level Security is the real isolation boundary**, not application code. `src/lib/db.ts`
  does unscoped `select("*")`/`upsert(...)` and trusts RLS entirely — there is no client-side
  owner filtering anywhere. This is deliberate: it means a bug in a React component can't leak
  cross-tenant data, because the database itself refuses the query.
- **Webhook authenticity via Svix HMAC signatures**, not a shared secret in a query string. The
  Resend inbound-email webhook (`parse-inbound-bill/index.ts`) verifies `svix-id`/
  `svix-timestamp`/`svix-signature` via the real `svix` npm package before trusting anything in
  the payload; an invalid signature is rejected with `401` before any Resend/Gemini/DB call is
  made.
- **File access via short-lived signed URLs / server-mediated proxy, never a public bucket.** The
  Supabase Storage bucket (`documents`) is private; the client gets a 1-hour signed URL per file,
  cached in memory (not persisted) and only re-signed when actually needed. A landlord's own
  Google Drive files are never given a public/shareable link at all — reads proxy through a
  `drive-download` edge function scoped to the caller's own session, and Drive's `drive.file`
  OAuth scope means the app's access token can only ever see files it created, a second layer of
  protection independent of the app's own logic.
- **Secrets never reach client code or the repo.** `GEMINI_API_KEY`, `RESEND_WEBHOOK_SECRET`,
  `GOOGLE_OAUTH_CLIENT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, etc. are Supabase Edge Function
  secrets, injected via `Deno.env`, never bundled into the Vite client build. A per-landlord
  Google Drive refresh token is additionally encrypted at rest via **Supabase Vault**
  (`google_drive_connections` + `SECURITY DEFINER` RPCs) — the plaintext token is only ever
  decrypted inside a trusted server context, never selectable through PostgREST directly.
  Provider portal passwords use the identical Vault pattern.
- **Server-side login lockout**, specifically so it can't be defeated by clearing browser storage
  — `check_login_lockout`/`record_login_failure`/`clear_login_failures` are `SECURITY DEFINER`
  RPCs backed by a real table, checked before every `signInWithPassword` call.
- **The one deliberately-anonymous surface is narrowly scoped.** The maintenance-request form
  (`src/routes/maintenance.tsx`) is the only page reachable without a login — it reads
  `properties_public` (address/alias/tenant-code only) and inserts into `maintenance_requests` as
  `anon`; a `BEFORE INSERT` trigger resolves the correct landlord's `owner_id` from the named
  property server-side, so an anonymous submitter never needs — or gets — read access to anything
  else.
- **A known, explicitly-tracked gap, not a silent one**: the inbound-email webhook runs on the
  service-role key (no landlord session exists for a webhook), so its own duplicate-detection and
  entity-matching reads are not owner-scoped — harmless with one real landlord, but flagged in
  code comments as needing a real per-landlord email-routing story (e.g. distinct receiving
  aliases) before a second landlord can safely forward email to the same pipeline.

## 5. Why the file-storage layer looks the way it does

Two real incidents shaped this app's current storage architecture, worth knowing when reading the
code:

1. **A Supabase egress overage**, traced to every file being stored as base64 directly in its
   owning table's column — which meant the full bytes of every photo, receipt, and lease got
   re-downloaded on every single page load (`src/lib/store.tsx` loads every table on mount). Fixed
   by moving file bytes out-of-line into Supabase Storage, fetched only on-demand
   (`src/lib/files.ts`), with an in-memory cache so re-opening the same document within a session
   doesn't re-fetch it.
2. **A move toward landlord-owned storage.** Rather than every landlord's files living in one
   bucket this app's operator controls, each landlord can now connect their own Google Drive
   (`drive.file` scope) from Settings; new uploads go there automatically once connected, with a
   one-off per-owner migration script for anything already in the shared bucket. A landlord who
   hasn't connected keeps working exactly as before — both backends are supported simultaneously,
   with the marker prefix (`storage:` vs `gdrive:`) on each file field indicating which one a
   given file lives in.
