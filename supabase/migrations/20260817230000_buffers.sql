CREATE TABLE public.buffers (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  "scopeType" text NOT NULL DEFAULT 'Portfolio',
  "scopeId" text,
  label text NOT NULL DEFAULT '',
  "targetAmount" numeric,
  "targetMonths" numeric,
  "currentBalance" numeric NOT NULL DEFAULT 0
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.buffers TO authenticated;
GRANT ALL ON public.buffers TO service_role;
ALTER TABLE public.buffers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_full_access" ON public.buffers FOR ALL TO authenticated USING (true) WITH CHECK (true);
