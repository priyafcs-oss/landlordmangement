-- Four new per-property tracked-record tables, replacing what used to be single-value fields
-- (compliance dates, one insurance policy) or nothing at all (maintenance jobs, free-form notes)
-- with proper multi-row trackers — matching the property detail page's new Insurance,
-- Maintenance, Compliance and Notes tabs.

CREATE TABLE public.insurance_policies (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  "propertyId" text NOT NULL,
  "unitId" text,
  insurer text NOT NULL,
  "coverTypes" text[] NOT NULL DEFAULT '{}',
  "policyNumber" text,
  "coverStart" date,
  "coverEnd" date,
  premium numeric,
  "premiumFrequency" text,
  "sumInsured" numeric,
  excess numeric,
  "coverageSummary" text,
  "documentType" text,
  "replacesPolicyId" text,
  "isSeparatePolicy" boolean,
  "fileName" text,
  "fileData" text
);

CREATE TABLE public.maintenance_items (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  "propertyId" text NOT NULL,
  "unitId" text,
  "itemType" text NOT NULL CHECK ("itemType" IN ('Repair', 'Major Work')),
  title text NOT NULL,
  description text,
  priority text,
  "tradeCategory" text,
  "projectType" text,
  status text NOT NULL DEFAULT 'New',
  "scheduledDate" date,
  "startDate" date,
  "completedDate" date,
  cost numeric,
  budget numeric,
  "progressNotes" text,
  "contractorName" text,
  "contractorEmail" text,
  "contractorPhone" text,
  photos jsonb NOT NULL DEFAULT '[]',
  "sourceFileName" text,
  "sourceFileData" text
);

CREATE TABLE public.compliance_certificates (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  "propertyId" text NOT NULL,
  "certType" text NOT NULL,
  issuer text,
  "referenceNumber" text,
  notes text,
  "issueDate" date,
  "expiryDate" date,
  "fileName" text,
  "fileData" text
);

CREATE TABLE public.property_notes (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  "propertyId" text NOT NULL,
  "unitId" text,
  title text NOT NULL,
  category text,
  tags text[] NOT NULL DEFAULT '{}',
  "reminderDate" date,
  content text,
  attachments jsonb NOT NULL DEFAULT '[]'
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['insurance_policies', 'maintenance_items', 'compliance_certificates', 'property_notes']
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY "single_landlord_app_access" ON public.%I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)',
      t
    );
  END LOOP;
END $$;
