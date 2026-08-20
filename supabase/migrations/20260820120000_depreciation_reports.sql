-- Method/Division split (Diminishing Value vs Prime Cost, Div 40 vs Div 43) plus denormalized
-- report metadata for bulk "Add depreciation report" uploads — same billGroupId-style grouping
-- pattern as property_bills, no separate report table.

ALTER TABLE public.depreciation_items
  ADD COLUMN method text,
  ADD COLUMN division text,
  ADD COLUMN "reportId" text,
  ADD COLUMN "quantitySurveyor" text,
  ADD COLUMN "reportReference" text,
  ADD COLUMN "reportDate" date,
  ADD COLUMN "effectiveFrom" date,
  ADD COLUMN "sourceFileName" text,
  ADD COLUMN "sourceFileData" text;
