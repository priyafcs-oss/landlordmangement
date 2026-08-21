-- Bills and flagged one-off transactions now stage through ai_intake_proposals like every
-- other inbound document kind, instead of writing directly into expenses. These three envelope
-- columns are common across all kinds (not per-payload) so the shared review-card header can
-- show them consistently regardless of kind.
ALTER TABLE public.ai_intake_proposals
  ADD COLUMN "documentDate" text,
  ADD COLUMN "providerName" text,
  ADD COLUMN "addressedTo" text;
