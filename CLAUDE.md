# Landlord OS

A multi-tenant landlord management app. Each Supabase Auth account gets its own completely
separate portfolio (properties, tenants, leases, bills, loans, expenses, documents) — no user can
see another user's data.

## Stack

- React + TanStack Start (file-based routes in `src/routes/`), Tailwind, shadcn/ui (`src/components/ui/`).
- Supabase: Postgres + Auth + RLS + Edge Functions (Deno, `supabase/functions/`).
- All client-side data access goes through **one file**, `src/lib/db.ts` — generic `selectAll`/
  `upsertRow`/`updateRow`/`deleteRow` helpers keyed by the `TABLES` map, with no per-table logic
  and no client-side owner filtering. `src/lib/store.tsx` is the single React context that loads
  every table on mount (`Promise.all` of `selectAll` calls) and holds the whole portfolio as one
  in-memory `AppState`, cached to `localStorage` for instant repaint on the next load.

## Multi-tenancy / auth model

Every table has an `owner_id uuid references auth.users(id)`, defaulting to
`COALESCE(auth.uid(), <first-created auth user>)`, and one RLS policy:
`FOR ALL TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid())`
(see `supabase/migrations/20260913100000_multi_tenant_owner_scoping.sql`). Because `db.ts` does
unscoped `select("*")`/`upsert(...)` and trusts RLS entirely, tenant isolation lives almost
entirely in the database — the frontend needs no per-query owner filtering.

- **Sign-in / sign-up / password reset / show-hide password**: `src/components/AuthGate.tsx`.
  Sign-up is self-service (`supabase.auth.signUp`) — safe specifically because owner-scoped RLS
  means a new account starts with zero visibility into anyone else's rows.
- **Login lockout**: server-side, not client-side (can't be bypassed by clearing browser
  storage). `public.login_attempts` table + three `SECURITY DEFINER` RPCs —
  `check_login_lockout`, `record_login_failure`, `clear_login_failures` — called from `AuthGate.tsx`
  around `signInWithPassword`. 5 failed attempts for an email blocks further tries on it for 5
  minutes (`supabase/migrations/20260913110000_login_lockout.sql`).
- **Change email / change password**: "Account & Security" card in `src/routes/settings.tsx`,
  via `supabase.auth.updateUser({ email })` / `({ password })`.
- **Sign out**: `src/components/AppHeader.tsx` — also clears the `localStorage` portfolio cache
  (`clearCache()` in `store.tsx`) so the next person to sign in on the same browser never briefly
  sees the previous account's cached data before `refresh()` overwrites it.
- **New signup's first Settings load**: a trigger on `auth.users` (`handle_new_user`) creates a
  default `app_settings` row per new user — `app_settings` used to be a single global "singleton"
  row; it's now one row per user, keyed by `owner_id`.
- **Public, unauthenticated surfaces** (no per-tenant login exists for these):
  - The maintenance-request form (`src/routes/maintenance.tsx`) reads `properties_public` (a
    `SECURITY DEFINER` view exposing only address/alias/tenant-code) and inserts into
    `maintenance_requests` as `anon`. A `BEFORE INSERT` trigger resolves `owner_id` from the named
    property so the request lands with the right landlord.

## Edge functions (`supabase/functions/`)

Most (`extract-*`, `domain-lookup`) have `verify_jwt = false` in `config.toml` because this
project's API key is the newer opaque `sb_publishable_`/`sb_secret_` format, which isn't a JWT and
would fail gateway verification unconditionally — even for a genuinely signed-in user's session
token, which IS a real JWT. Two of them do real DB writes and handle this themselves:

- **`upload-document`, `reparse-document`**: verify the caller's bearer token in-function
  (`supabase.auth.getUser()`), then build the Supabase client **from that token**, not the
  service-role key — every downstream read/write in the classify → extract → stage pipeline
  (`parse-inbound-bill/router.ts` and its parsers) is therefore automatically owner-scoped by RLS,
  with zero owner_id plumbing needed through those parser files.
- **`parse-inbound-bill`**: a Resend webhook (Svix-signature verified, no user session) — stays on
  the service-role key. Inserts still get a sane `owner_id` via each table's column default, but
  its reads (duplicate-filename check, `entities` lookup) are NOT owner-scoped. Harmless with one
  real landlord; needs a real per-landlord email-routing story (e.g. a distinct receiving alias
  per landlord) before a second landlord can safely use email-forwarded bills.
- **`export-backup`**: full-database JSON dump gated by a shared secret (`BACKUP_EXPORT_SECRET`),
  not a user session — intentionally NOT owner-scoped; it's a complete-DB backup tool, not a
  per-user export.

## Deploy

- App: Supabase CLI + GitHub + Vercel.
- DB migrations: `supabase db push` (or via CI) — files in `supabase/migrations/`, applied in
  filename-timestamp order.
- Edge functions deploy **separately** from a git push: `supabase functions deploy <name>`.
- Typecheck an edge function before deploying: `DENO_NO_PACKAGE_JSON=1 npx deno check <path>`.
