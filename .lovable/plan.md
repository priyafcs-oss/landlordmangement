## Scope

Batch of refinements on top of the existing local-first (localStorage) landlord app. No backend changes — all data stays in `landlord-app-v3` store. I'll bump the store key to `landlord-app-v4` and drop the seed so first-load is empty (item 10).

## Data model (`src/lib/types.ts`, `src/lib/store.tsx`)

- **New `LandlordProfile`**: `fullName, email, phone, notifyEmail, notifySms`.
- **New `PropertyBill`**: `id, propertyId, billType (Water|Council Rates|Strata|Insurance|Electricity|Gas|Other), amount, dueDate, status (Unpaid|Paid|Overdue), portalUrl?, portalUsername?, passwordNote?, notes?, recurrenceMonths?`.
- **Extend `Property`**: `purchaseDate?`, `lender?, loanAccountRef?, loanBalance?, interestRate?, repaymentFrequency?` (kept alongside existing `loans` table; new fields are inline "primary loan" metadata for the deep-dive tab).
- **Extend `Loan`**: `dueDay?, isDirectDebit?, linkedBankAccount?, status?`.
- **Remove** seed: empty state on fresh load, delete "Clear Sample Data" button from header.

## Views

1. **Settings route (`src/routes/settings.tsx`)** — new sidebar item. Form to edit landlord profile + notification prefs.
2. **Rental Hub (`src/routes/rental.tsx`)** — audit: confirm single master property dropdown, no tenant filter. Ensure Live Metrics card shows lease dates, last increase, next increase due (last + 12mo), and two action buttons (rent-increase letter + renewal offer) — extend where missing.
3. **Tenant onboarding (`src/routes/portfolio.tsx`)**:
   - Default `paidUpToDate = leaseStart - 1 day` on create.
   - Verify emergency contact / ID proof / bond receipt fields already present; add any missing.
4. **Ledger export** (`src/routes/rental.tsx`): "Download CSV", "Download PDF" (window.print of a hidden statement view), "Email Ledger" (mailto with CSV body / summary — no backend).
5. **Inspections (`src/routes/expenses.tsx`)** — verify dynamic room+item add/remove and `capture="environment"`. Add per-photo "Analyze with AI" button that calls `/api/copilot` with a vision prompt (budget-firewalled) and drops draft remarks into the item's notes.
6. **Maintenance (`src/routes/maintenance.tsx`)**: when route is loaded and app shell is present (non-public visit), show "Back to Dashboard" banner. Add a "Log Maintenance Request" button+form on the Dashboard for landlord-entered issues.
7. **Property form (`src/routes/portfolio.tsx`)**: add Purchase Date + Bank Loan section (lender/account/balance/rate/frequency). Edit form pre-populates.
8. **Property Bills**:
   - New `PropertyBillsTab` inside the property drawer with portal URL + username + password note (plain text, marked "stored locally") + bills list with Mark Paid → auto-creates next cycle by `recurrenceMonths`.
   - Dashboard "Housekeeping Alerts" widget: bills due within 7 days or overdue + EMIs due within 7 days, each with Mark Paid. Email notice uses landlord profile via `mailto:`.

## Explicit non-goals

- No Supabase / Cloud enable (staying on localStorage per existing architecture — profile lives in the same store).
- No real email/SMS delivery — Email Ledger and Housekeeping notifications open a `mailto:` prefilled from landlord profile.
- No PDF library — PDF export uses a print-styled statement view.
- Not rewriting the AI photo analyzer transport; reuses existing `/api/copilot` route with a text description prompt (image bytes are sent as data URLs).

## Verification

- `tsgo` for typecheck.
- Manual: create tenant → confirm paid-up = start - 1; add bill with 1-month recurrence → mark paid → next-cycle bill appears; dashboard widget shows it.
