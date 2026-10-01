import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * Deliberately a STANDALONE config, not merged into vite.config.ts — this app's vite.config.ts
 * wraps a third-party preset (@lovable.dev/vite-tanstack-config) that already bundles TanStack
 * Start, Nitro, and several build-only plugins; fighting that wrapper's custom defineConfig
 * signature for a `test` passthrough isn't worth it when Vitest only needs two of its plugins
 * (react, tsconfig-paths for the "@/" alias) to resolve this app's own source files correctly.
 *
 * Two test "projects" in one config, matching this codebase's two real runtimes:
 * - "client": jsdom environment, for src/** (React components, src/lib/*.ts browser code).
 * - "edge": plain node environment with a Deno global shim (see tests/setup.edge.ts), for
 *   supabase/functions/**\/*.ts — these run on Deno in production, but the specific files unit
 *   tested here (gemini.ts, classify.ts, core-parser.ts, copilot-chat/index.ts) have zero
 *   Deno-specific surface beyond `Deno.env.get`/`Deno.serve`, so a thin shim is enough to run the
 *   REAL production code under Vitest rather than a reimplementation. Files that use `npm:`
 *   specifiers or `Deno.serve` need the extra handling documented in
 *   tests/integration/resend-webhook.test.ts itself.
 *
 * Both projects' `include` is a directory glob EXCEPT the handful of files that need the other
 * project's environment — those are named explicitly in both projects' include/exclude so a new
 * test file only needs to be dropped in (and, if it imports supabase/functions/** source, added
 * to both lists here) rather than requiring a vitest.config.ts change for the common case.
 */
export default defineConfig({
  // Cast needed purely to satisfy TS: this project pins a very new `vite` (^8.0.16); `vitest`
  // bundles its own slightly different nested `vite` copy as a peer dependency, and the two
  // packages' otherwise-identical `Plugin` types don't structurally match at the type level
  // (differs deep in internal fields like PluginContextMeta.rolldownVersion). Purely a type-level
  // mismatch between two physically separate installs of the same plugin API — react()/
  // tsconfigPaths() work identically at runtime regardless of which `vite` typed them. A precise
  // cast isn't feasible here since defineConfig's own plugins type is a union across overloads.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  plugins: [react(), tsconfigPaths()] as any,
  resolve: {
    alias: [
      // Deno-style npm: specifiers (used by supabase/functions/**) aren't understood by Vite's
      // resolver — every OTHER `npm:@supabase/supabase-js@2` reference in these files besides
      // index.ts's `createClient` is a type-only import, which TypeScript erases before Vite ever
      // sees it, so only these two real VALUE imports need aliasing to their real npm equivalents.
      { find: "npm:@supabase/supabase-js@2", replacement: "@supabase/supabase-js" },
      { find: "npm:svix@1", replacement: "svix" },
    ],
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "client",
          environment: "jsdom",
          setupFiles: ["./tests/setup.client.ts"],
          // A directory glob, minus the specific files that need the "edge" project's node
          // environment + Deno shim below (they import real supabase/functions/** source).
          include: ["tests/unit/**/*.test.{ts,tsx}", "tests/integration/**/*.test.ts"],
          exclude: ["tests/unit/gemini-parser.test.ts", "tests/integration/resend-webhook.test.ts", "tests/integration/copilot-chat.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "edge",
          environment: "node",
          setupFiles: ["./tests/setup.edge.ts"],
          include: ["tests/unit/gemini-parser.test.ts", "tests/integration/resend-webhook.test.ts", "tests/integration/copilot-chat.test.ts"],
        },
      },
    ],
  },
});
