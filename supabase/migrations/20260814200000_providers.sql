CREATE TABLE public.providers (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  "propertyId" text,
  name text NOT NULL,
  role text NOT NULL DEFAULT 'Other',
  email text,
  phone text,
  website text,
  abn text,
  address text,
  notes text
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.providers TO authenticated;
GRANT ALL ON public.providers TO service_role;
ALTER TABLE public.providers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_full_access" ON public.providers FOR ALL TO authenticated USING (true) WITH CHECK (true);
