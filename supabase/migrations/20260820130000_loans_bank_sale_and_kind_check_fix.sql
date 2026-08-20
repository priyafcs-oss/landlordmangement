-- Fix: ai_intake_proposals.kind's original CHECK constraint only ever allowed
-- ('tenant_lease', 'rent_ledger') — every later kind added since (property_detail,
-- depreciation_report, unclassified, and the four added here) has been silently failing to
-- insert server-side. Dropping the CHECK entirely rather than re-enumerating it, since the
-- TypeScript union already validates this at every call site and other similar status/kind
-- text columns in this schema (PropertyBill.status, Expense.taxCategory) rely on that alone.
ALTER TABLE public.ai_intake_proposals DROP CONSTRAINT IF EXISTS ai_intake_proposals_kind_check;

-- loan_statement proposals match against an existing Loan the same way rent_ledger matches a Tenant.
ALTER TABLE public.ai_intake_proposals ADD COLUMN "matchedLoanId" text;

-- Compliance certificates beyond smoke alarm, plus a simplified disposal/sale record.
ALTER TABLE public.properties
  ADD COLUMN "electricalSafetyCertExpiry" date,
  ADD COLUMN "gasSafetyCertExpiry" date,
  ADD COLUMN "saleDate" date,
  ADD COLUMN "salePrice" numeric,
  ADD COLUMN "sellingCosts" numeric;
