ALTER TABLE public.gold_details ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.etf_details ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
