CREATE TABLE public.entities (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  name text NOT NULL,
  type text NOT NULL DEFAULT 'Individual',
  owners jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.entities TO authenticated;
GRANT ALL ON public.entities TO service_role;
ALTER TABLE public.entities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_full_access" ON public.entities FOR ALL TO authenticated USING (true) WITH CHECK (true);
