// This file (and the two test files under vitest.config.ts's "edge" project) intentionally
// imports real Deno-runtime source (supabase/functions/**) under Node — tsconfig.json's own
// `exclude` list deliberately keeps this file and those two test files OUT of tsc's/the editor's
// type-checking (that source is normally typechecked via `deno check` instead, see CLAUDE.md,
// which understands Deno's globals and `npm:` specifiers natively). Vitest still RUNS these files
// correctly regardless — its esbuild-based transform strips types without requiring full type
// soundness. See TESTING.md's "known limitations" section.
/**
 * The "edge" Vitest project runs REAL Supabase Edge Function source files
 * (supabase/functions/**\/*.ts) under Node instead of their real Deno runtime, so the handful of
 * Deno-specific globals those files actually touch need a minimal shim here. This is deliberately
 * narrow — only `Deno.env.get` is used by the files under test
 * (gemini.ts/classify.ts/core-parser.ts/index.ts); none of them touch Deno's filesystem, permission,
 * or other runtime APIs, so nothing beyond `env` is shimmed.
 *
 * Individual test files still own stubbing the actual env VALUES they need
 * (`vi.stubEnv`/`process.env.X = ...`) — this file only makes `Deno.env.get` itself resolve to
 * `process.env`, matching how these functions read config in production (`supabase secrets set`
 * populates `Deno.env` the same way).
 */
(globalThis as unknown as { Deno: { env: { get(key: string): string | undefined } } }).Deno = {
  env: { get: (key: string) => process.env[key] },
};
