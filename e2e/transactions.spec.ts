import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * End-to-end: sidebar navigation -> Rental Hub -> creating a manual transaction with an attached
 * document -> confirming it lands in the transaction list. Uses the storage state saved by
 * e2e/auth.setup.ts (see playwright.config.ts's "setup" project dependency) so this spec starts
 * already signed in.
 *
 * Two corrections from the original brief, both confirmed by reading the real source rather than
 * assumed:
 * 1. "Rental Hub" (sidebar, src/components/AppSidebar.tsx) is a portfolio-wide rent-ledger view —
 *    the actual "Add Transaction" flow (src/components/AddTransactionDialog.tsx) lives on the
 *    separate /transactions route, not inside Rental Hub itself. This spec visits Rental Hub first
 *    (the navigation the brief asked for, and a real smoke-check that it renders) then goes to
 *    /transactions to create the transaction, rather than inventing a button that doesn't exist.
 * 2. There is no `.range(0, 19)`-style server-side pagination anywhere in this app to verify —
 *    src/lib/db.ts's selectAll loads each table in full on app load (see CLAUDE.md: "store.tsx...
 *    loads every table on mount"), and grepping transactions.tsx confirms no client-side
 *    page-size/slice logic either. The real, verifiable equivalent of "does the new row actually
 *    show up" is asserting it appears in the rendered list, which is what this spec does instead.
 */
test("create a manual transaction with an attached document and see it in the list", async ({ page }) => {
  await page.goto("/rental");
  await expect(page.getByRole("heading", { name: /rental/i }).first()).toBeVisible();

  await page.goto("/transactions");
  await page.getByRole("button", { name: "Add Transaction" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText("New transaction")).toBeVisible();

  // This codebase's shared Field component (src/components/Field.tsx) never associates its
  // <Label> with the following <Input> via htmlFor/id — getByLabel() would silently find nothing.
  // The real, matching DOM shape is <div><Label>{text}</Label><Input/></div>, so the label text
  // and its input are siblings; this locates the input by walking to the label's next sibling.
  const fieldInput = (label: string) => page.getByText(label, { exact: true }).locator("xpath=following-sibling::*[1]");

  const uniqueSuffix = Date.now();
  const payee = `E2E Test Vendor ${uniqueSuffix}`;
  await fieldInput("Payee / vendor").fill(payee);
  await fieldInput("Description").fill("Playwright E2E manual transaction");
  await fieldInput("Amount").fill("123.45");

  // Deliberately the SECOND file input ("Additional files / photos", a plain attachment) rather
  // than the first ("Upload a receipt for AI extraction") — attaching to the AI dropzone would
  // trigger a real Gemini call against a synthetic dummy PDF, making this spec slow and flaky on
  // an outcome (AI extraction succeeding/failing) unrelated to what it's actually verifying.
  // setInputFiles works against the underlying <input type="file"> even though it's visually
  // hidden behind styled drop-zone UI.
  await page
    .getByText("Additional files / photos")
    .locator("xpath=following::input[@type='file'][1]")
    .setInputFiles(path.join(__dirname, "fixtures", "dummy-receipt.pdf"));

  await page.getByRole("button", { name: "Save" }).click();

  // Sonner (this app's toast library, see AuthGate/StorageUsageSettings for the same pattern)
  // confirms the save; the dialog closing is the second, state-level confirmation.
  await expect(page.locator("[data-sonner-toast]").first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("dialog")).not.toBeVisible();

  // The real end-to-end assertion: the new transaction is actually in the list, not just that a
  // success toast appeared (a toast alone wouldn't catch a save that succeeded but rendered wrong).
  await expect(page.getByText(payee).first()).toBeVisible();
  await expect(page.getByText("123.45").first()).toBeVisible();
});
