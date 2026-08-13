-- Premises-level disclosures required on a standard NSW residential tenancy
-- agreement (smoke alarms, strata bylaws, nominated repairers, embedded
-- network disclosures). These describe the property, not a specific
-- tenancy, so they're captured once and reused for every future tenant.
ALTER TABLE public.properties
  ADD COLUMN "maxOccupants" integer,
  ADD COLUMN "premisesInclusions" text,
  ADD COLUMN "smokeAlarmType" text CHECK ("smokeAlarmType" IN ('Hardwired', 'Battery')),
  ADD COLUMN "smokeAlarmBatteryReplaceable" boolean,
  ADD COLUMN "smokeAlarmBatteryType" text,
  ADD COLUMN "smokeAlarmBackupBatteryReplaceable" boolean,
  ADD COLUMN "smokeAlarmBackupBatteryType" text,
  ADD COLUMN "strataResponsibleForSmokeAlarms" boolean,
  ADD COLUMN "strataBylawsApply" boolean,
  ADD COLUMN "electricalRepairsContactName" text,
  ADD COLUMN "electricalRepairsContactPhone" text,
  ADD COLUMN "plumbingRepairsContactName" text,
  ADD COLUMN "plumbingRepairsContactPhone" text,
  ADD COLUMN "otherRepairsContactName" text,
  ADD COLUMN "otherRepairsContactPhone" text,
  ADD COLUMN "waterUsagePaidSeparately" boolean,
  ADD COLUMN "electricityEmbeddedNetwork" boolean,
  ADD COLUMN "gasEmbeddedNetwork" boolean;
