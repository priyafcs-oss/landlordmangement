-- Property Details progressive disclosure: adds operational essentials (alias,
-- property manager contact, council rate / water account references) and
-- acquisition fields (stamp duty, deposit, lot size, physical attributes)
-- surfaced behind a collapsed "advanced" section in the property form.
ALTER TABLE public.properties
  ADD COLUMN alias text,
  ADD COLUMN "managerName" text,
  ADD COLUMN "managerPhone" text,
  ADD COLUMN "managerEmail" text,
  ADD COLUMN "councilRateRef" text,
  ADD COLUMN "waterAccountRef" text,
  ADD COLUMN "stampDuty" numeric,
  ADD COLUMN deposit numeric,
  ADD COLUMN "lotSize" text,
  ADD COLUMN "physicalAttributes" text;
