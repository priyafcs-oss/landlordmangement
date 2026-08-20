-- Lets a tenant's own address override the property's — for one title with multiple dwellings
-- (e.g. a house + granny flat sharing one Property record for purchase price/loan/cost base)
-- where each tenant's ledger/lease/invoices/portal need to show their actual unit address.

ALTER TABLE public.tenants
  ADD COLUMN "unitAddress" text;
