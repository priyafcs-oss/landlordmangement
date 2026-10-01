import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // this app's data model loads the whole portfolio into one AppState per
  // session (src/lib/store.tsx) — parallel specs sharing one test account would race each other's
  // writes; keep this false unless/until tests are split across isolated test accounts.
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    // Runs once, signs in through the real UI, and saves the resulting session (Supabase Auth
    // persists its session in localStorage — see src/integrations/supabase/client.ts — which
    // Playwright's storageState captures alongside cookies) for every other project to reuse,
    // so each spec doesn't have to repeat a full sign-in flow.
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "e2e",
      use: { ...devices["Desktop Chrome"], storageState: "playwright/.auth/user.json" },
      dependencies: ["setup"],
    },
  ],
  // Starts the app's own dev server automatically if one isn't already running on BASE_URL —
  // does NOT start Supabase itself (see TESTING.md: run `supabase start` first, separately).
  webServer: {
    command: "npm run dev",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
