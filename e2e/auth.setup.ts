import { test as setup, expect } from "@playwright/test";

const AUTH_FILE = "playwright/.auth/user.json";

/**
 * Signs in through the REAL sign-in screen (src/components/AuthGate.tsx) once, then saves the
 * resulting session for every other e2e spec to reuse (see playwright.config.ts's "setup"
 * project). Selectors here are deliberately NOT getByLabel()/data-testid — this codebase's shared
 * Field/Label components (src/components/Field.tsx, and AuthGate's own inline labels) never
 * associate a <Label> with its <Input> via htmlFor/id, so those queries would silently fail. Using
 * the `autocomplete` attributes instead, which the real inputs do carry, is what actually matches
 * production markup rather than an idealized one — see TESTING.md's "known limitations" for the
 * suggestion to add data-testid attributes as a small follow-up that would make this more robust.
 *
 * Requires E2E_TEST_EMAIL / E2E_TEST_PASSWORD for an existing account on whichever Supabase
 * project E2E_BASE_URL's app is pointed at — see TESTING.md. Never run this against a real
 * landlord's production account.
 */
setup("authenticate", async ({ page }) => {
  const email = process.env.E2E_TEST_EMAIL;
  const password = process.env.E2E_TEST_PASSWORD;
  if (!email || !password) {
    throw new Error("Set E2E_TEST_EMAIL and E2E_TEST_PASSWORD before running e2e tests — see TESTING.md.");
  }

  await page.goto("/");

  await page.locator('input[autocomplete="email"]').fill(email);
  await page.locator('input[autocomplete="current-password"]').fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();

  // AuthGate renders the signed-in app shell once the session resolves — the sidebar's presence
  // is a reliable "actually logged in" signal without depending on which route loads first.
  await expect(page.getByRole("link", { name: /rental/i }).first()).toBeVisible({ timeout: 15_000 });

  await page.context().storageState({ path: AUTH_FILE });
});
