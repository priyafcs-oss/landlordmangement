# Testing

## What's here, and one correction up front

This app runs on **TanStack Start** (Vite) with a **Supabase Edge Functions** (Deno) backend, not
Next.js — so "unit test a Gemini SDK" and "test a Next.js API route" don't map onto real files in
this repo. Both are adapted to what actually exists and are genuine tests of the REAL production
code (imported directly, not reimplemented), verified to pass locally before being committed:

| Requested | What actually exists | Test file |
|---|---|---|
| Unit test the Gemini AI parser, mocking the SDK | No SDK exists — `gemini.ts` calls `generativelanguage.googleapis.com` via plain `fetch()`. Mocks `fetch` instead. | `tests/unit/gemini-parser.test.ts` |
| Integration test a Next.js API route webhook | The webhook is `supabase/functions/parse-inbound-bill/index.ts`, a Deno Edge Function. Imported and invoked directly with constructed `Request` objects. | `tests/integration/resend-webhook.test.ts` |
| Signed-URL caching | Real — `src/lib/files.ts`'s Blob cache, covering both its Supabase Storage and Google Drive backends. | `tests/integration/signed-url-cache.test.ts` |
| E2E transaction creation + `.range(0, 19)` pagination | The pagination doesn't exist — `src/lib/db.ts` loads each table in full, no server-side paging anywhere in this app. Verifies the real end state (the created transaction appears in the list) instead. | `e2e/transactions.spec.ts` |

All four were run locally against this repo's real code before being committed — `npm test`
currently passes 16/16, `npx tsc --noEmit` is clean, and `npx playwright test --list` resolves
both e2e specs correctly.

## Stack

- **Vitest 3** (`vitest.config.ts`) for unit + integration tests, in two "projects":
  - `client` — jsdom environment, for browser-side code (`src/lib/files.ts`'s caching, future
    React component tests via `@testing-library/react`).
  - `edge` — plain Node environment with a minimal `Deno.env` shim (`tests/setup.edge.ts`), so the
    REAL Supabase Edge Function source (`supabase/functions/parse-inbound-bill/**`) can be
    imported and run directly rather than reimplemented. Two Deno-style `npm:` specifiers
    (`npm:@supabase/supabase-js@2`, `npm:svix@1`) are aliased to their real npm packages in
    `vitest.config.ts`'s `resolve.alias` — the only two VALUE imports of that form in the pipeline;
    every other occurrence is a type-only import, erased before Vite ever sees it.
- **Playwright** (`playwright.config.ts`) for the E2E browser flow, with a `setup` project that
  signs in once through the real UI and reuses the session (`playwright/.auth/user.json`) for
  every spec.

## Running locally

### 1. Start a local Supabase instance

```powershell
supabase start
```

This is a genuinely separate, isolated Postgres/Auth/Storage instance from your production
project — running tests against it (rather than the hosted `*.supabase.co` project your `.env`
already points at) is the only safe way to run E2E tests without risking real landlord data.
`supabase/config.toml` has no port overrides, so the standard CLI defaults apply: API `54321`,
DB `54322`, Studio `54323`. `supabase status` prints the local anon/publishable key you'll need
below.

Push this repo's migrations into it once:

```powershell
supabase db push --local
```

Then create at least one test account (via Studio at `http://127.0.0.1:54323`, or
`supabase/functions`'s own signup flow) — the E2E suite needs real credentials for it.

### 2. Environment files

Create `.env.test.local` (git-ignored, do **not** reuse the committed `.env`/`.env.local`, which
point at the hosted production project):

```
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=<from `supabase status`>
E2E_BASE_URL=http://localhost:3000
E2E_TEST_EMAIL=<the test account you created above>
E2E_TEST_PASSWORD=<its password>
```

The two `tests/unit`/`tests/integration` suites don't need this file at all — they mock the
Supabase client module entirely (see each test file's own `vi.mock(...)` call) rather than hitting
a real database, precisely so `npm test` never depends on a running Supabase instance.

### 3. Install dependencies

```powershell
npm install
npx playwright install chromium
```

### 4. Run the suites

```powershell
npm test              # Vitest, once
npm run test:watch    # Vitest, watch mode
npm run test:e2e      # Playwright — starts the dev server automatically (webServer in
                       # playwright.config.ts), but NOT Supabase — that must already be running
npm run test:e2e:ui   # Playwright's interactive UI mode, useful while writing new specs
```

## Known limitations (accepted tradeoffs, not oversights)

- **`tests/unit/gemini-parser.test.ts` and `tests/integration/resend-webhook.test.ts` are excluded
  from `tsconfig.json`'s type-checking** (see the `exclude` entry there, and
  `tests/setup.edge.ts`'s doc comment). They import real Deno-runtime source, which is normally
  typechecked separately via `deno check <path>` (per `CLAUDE.md`) — bolting a second, parallel
  type environment onto this project's own `src/`-scoped `tsconfig.json` for two test files isn't
  worth the complexity. Vitest still **runs** them correctly regardless (its esbuild transform
  doesn't require full type soundness) — only editor/`tsc` red squiggles are the tradeoff. If you
  change the edge-function source these tests import, typecheck it the normal way:
  `DENO_NO_PACKAGE_JSON=1 npx deno check supabase/functions/parse-inbound-bill/index.ts`.
- **E2E selectors use `input[autocomplete="..."]`/text-proximity, not `getByLabel()`/
  `data-testid`.** This codebase's shared `Field`/`Label` components (`src/components/Field.tsx`,
  and `AuthGate.tsx`'s own inline labels) never associate a `<Label>` with its `<Input>` via
  `htmlFor`/`id` — confirmed by reading the actual components, not assumed. Adding `data-testid`
  attributes to `Field` and the auth form would make E2E tests meaningfully more robust; flagged
  here as a good small follow-up rather than done silently as part of this test suite.
- **`vitest.config.ts` has one `as any` cast** on its `plugins` array, with an inline comment
  explaining why: this project pins a very new `vite` (`^8.0.16`) while `vitest` bundles its own
  slightly different nested `vite` peer dependency, and the two packages' otherwise-identical
  `Plugin` types don't structurally match at the type level (differs deep in internal fields).
  Purely a type-level mismatch between two physical installs of the same plugin API — confirmed
  the cast doesn't affect runtime behavior by actually running the suite.
- **The E2E spec attaches its dummy PDF to the "Additional files / photos" input, not the primary
  AI-extraction dropzone**, specifically to avoid triggering a real Gemini call against synthetic
  file bytes during the test (slow and non-deterministic for something the AI-parsing unit tests
  already cover separately).
- **Playwright's `fullyParallel` is `false`.** This app loads a landlord's whole portfolio into one
  in-memory `AppState` per session (`src/lib/store.tsx`) — parallel specs sharing one test account
  would race each other's writes. Fine for now with a handful of specs; revisit if the E2E suite
  grows enough that this becomes a real bottleneck (e.g. by giving each spec file its own test
  account).
