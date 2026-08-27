-- Lets a tenancy, expense, bill, or provider contact be scoped to one specific dwelling on a
-- multi-unit property (house + granny flat, dual-key) rather than always the whole property.
-- Whole-property shared costs (council rates, land tax, building insurance) simply leave this
-- unset -- it's never inferred or auto-split, only ever set when the landlord explicitly files
-- something to one unit. `units` itself (properties.units, a jsonb array) already carries each
-- dwelling's own id -- no schema change needed there, only the id key added to existing JSON rows.
ALTER TABLE public.tenants
  ADD COLUMN "unitId" text;

ALTER TABLE public.expenses
  ADD COLUMN "unitId" text;

ALTER TABLE public.property_bills
  ADD COLUMN "unitId" text;

ALTER TABLE public.providers
  ADD COLUMN "unitId" text;
