
CREATE TABLE public.properties (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  address text NOT NULL DEFAULT '',
  "purchasePrice" numeric NOT NULL DEFAULT 0,
  "currentValue" numeric NOT NULL DEFAULT 0,
  "purchaseDate" text,
  "tenantCode" text,
  lender text,
  "loanAccountRef" text,
  "loanBalance" numeric,
  "interestRate" numeric,
  "repaymentFrequency" text
);

CREATE TABLE public.tenants (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  name text NOT NULL DEFAULT '',
  "rentAmount" numeric NOT NULL DEFAULT 0,
  "rentFrequency" text NOT NULL DEFAULT 'Weekly',
  email text,
  phone text,
  "emergencyContactName" text,
  "emergencyContactRelationship" text,
  "emergencyContactPhone" text,
  "emergencyContact" text,
  "permanentAddress" text,
  "noticePeriod" text,
  "propertyId" text NOT NULL,
  "leaseStart" text,
  "leaseExpiry" text,
  "leaseDuration" text,
  "lastRentIncreaseDate" text,
  "bankReference" text,
  "bankAccountHolder" text,
  "paidUpToDate" text NOT NULL DEFAULT '',
  "bondAmount" numeric,
  "bondLodgementDate" text,
  "bondReceiptNumber" text,
  "leaseDocumentFileName" text,
  "leaseDocumentFileData" text,
  "idProofFileName" text,
  "idProofFileData" text,
  "bondTransferFileName" text,
  "bondTransferFileData" text
);

CREATE TABLE public.ledger_entries (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  "tenantId" text NOT NULL,
  date text NOT NULL DEFAULT '',
  type text NOT NULL DEFAULT 'Rent Payment',
  description text NOT NULL DEFAULT '',
  debit numeric NOT NULL DEFAULT 0,
  credit numeric NOT NULL DEFAULT 0,
  "newPaidUpToDate" text,
  manual boolean,
  "linkedInvoiceId" text,
  "daysShift" numeric
);

CREATE TABLE public.tenant_invoices (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  "tenantId" text NOT NULL,
  "chargeType" text NOT NULL DEFAULT 'Other',
  "amountDue" numeric NOT NULL DEFAULT 0,
  "dateIssued" text NOT NULL DEFAULT '',
  "dueDate" text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'Unpaid',
  description text
);

CREATE TABLE public.loans (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  "propertyId" text NOT NULL,
  "bankName" text NOT NULL DEFAULT '',
  "totalBalance" numeric NOT NULL DEFAULT 0,
  "interestRate" numeric NOT NULL DEFAULT 0,
  "monthlyEmi" numeric NOT NULL DEFAULT 0,
  "dueDayOfMonth" numeric,
  "isDirectDebit" boolean,
  "linkedBankAccount" text,
  status text
);

CREATE TABLE public.expenses (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  "itemName" text NOT NULL DEFAULT '',
  cost numeric NOT NULL DEFAULT 0,
  date text NOT NULL DEFAULT '',
  "propertyId" text NOT NULL,
  "taxCategory" text NOT NULL DEFAULT 'Immediate Deduction',
  "invoiceFileName" text,
  "invoiceFileData" text,
  "hasWarranty" boolean NOT NULL DEFAULT false,
  "warrantyExpiry" text,
  "rechargeToTenant" boolean NOT NULL DEFAULT false,
  "tenantId" text
);

CREATE TABLE public.inspections (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  "propertyId" text NOT NULL,
  date text NOT NULL DEFAULT '',
  type text NOT NULL DEFAULT 'Routine',
  status text NOT NULL DEFAULT 'Scheduled',
  notes text,
  "fileFileName" text,
  "fileData" text,
  checklist jsonb,
  rooms jsonb,
  photos jsonb,
  signature text
);

CREATE TABLE public.rent_changes (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  "tenantId" text NOT NULL,
  "changeDate" text NOT NULL DEFAULT '',
  "oldRent" numeric NOT NULL DEFAULT 0,
  "newRent" numeric NOT NULL DEFAULT 0
);

CREATE TABLE public.lease_history (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  "tenantId" text NOT NULL,
  "originalStartDate" text NOT NULL DEFAULT '',
  "pastStartDate" text NOT NULL DEFAULT '',
  "pastEndDate" text NOT NULL DEFAULT '',
  "pastRent" numeric NOT NULL DEFAULT 0,
  "pastFrequency" text NOT NULL DEFAULT 'Weekly'
);

CREATE TABLE public.maintenance_requests (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  "propertyId" text,
  "propertyAddressTyped" text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  urgency text NOT NULL DEFAULT 'Medium',
  photos jsonb NOT NULL DEFAULT '[]'::jsonb,
  video jsonb,
  status text NOT NULL DEFAULT 'Pending',
  "contactName" text NOT NULL DEFAULT '',
  "contactPhone" text NOT NULL DEFAULT '',
  "contactEmail" text NOT NULL DEFAULT '',
  "createdAt" text NOT NULL DEFAULT '',
  source text
);

CREATE TABLE public.property_bills (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  "propertyId" text NOT NULL,
  "billType" text NOT NULL DEFAULT 'Other',
  amount numeric NOT NULL DEFAULT 0,
  "dueDate" text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'Unpaid',
  "paidDate" text,
  "portalUrl" text,
  "portalUsername" text,
  "passwordNote" text,
  notes text,
  "recurrenceMonths" numeric
);

CREATE TABLE public.app_settings (
  id text PRIMARY KEY,
  updated_at timestamptz NOT NULL DEFAULT now(),
  "aiConfig" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "landlordProfile" jsonb NOT NULL DEFAULT '{}'::jsonb
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['properties','tenants','ledger_entries','tenant_invoices','loans','expenses','inspections','rent_changes','lease_history','maintenance_requests','property_bills','app_settings']
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY "single_landlord_app_access" ON public.%I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

INSERT INTO public.app_settings (id, "aiConfig", "landlordProfile")
VALUES ('singleton',
  '{"enabled":true,"dailyCount":0,"countDate":"1970-01-01","dailyLimit":10}'::jsonb,
  '{"fullName":"","email":"","phone":"","notifyEmail":true,"notifySms":false}'::jsonb);
