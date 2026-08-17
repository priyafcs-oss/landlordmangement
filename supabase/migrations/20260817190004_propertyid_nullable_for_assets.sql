-- Both columns were NOT NULL from the original bootstrap migration, even though the app's own
-- types already mark propertyId optional on Expense. A non-property asset (Gold, ETF) has no
-- property to attach a transaction/bill to — it uses assetId instead — so this constraint would
-- otherwise reject every Gold/ETF transaction and bill outright.
ALTER TABLE public.expenses ALTER COLUMN "propertyId" DROP NOT NULL;
ALTER TABLE public.property_bills ALTER COLUMN "propertyId" DROP NOT NULL;
