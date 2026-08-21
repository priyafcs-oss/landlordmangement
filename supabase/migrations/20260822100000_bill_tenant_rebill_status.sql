-- Water bills used to be unconditionally forced into human review (the "Recharge Review — Water
-- Bill" guardrail), purely so a landlord would see the recharge-to-tenant decision. That's being
-- removed -- a clean water bill now auto-approves like any other bill type -- but the recharge
-- decision itself still needs surfacing somewhere, so it doesn't just get lost. This column
-- tracks that: set to 'pending' when a Water bill auto-approves, cleared to 'resolved' once the
-- landlord has looked at it (via BillDetailDialog) and either recharged it or explicitly said
-- no recharge is needed. Nullable/absent means "not applicable" (non-Water bills, or bills that
-- predate this column).
ALTER TABLE public.property_bills
  ADD COLUMN "tenantRebillStatus" text;
