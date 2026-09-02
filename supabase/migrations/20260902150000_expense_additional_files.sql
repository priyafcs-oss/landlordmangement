-- A transaction previously had room for exactly one invoice/receipt file (invoiceFileName +
-- invoiceFileData), which silently overwrites the existing one whenever a second file needs
-- attaching — e.g. an agent-statement-derived expense (whose "invoice" is really the whole rent
-- statement) later getting the actual bill PDF, where both are worth keeping. Extra files/photos
-- beyond the primary one go here instead. Same shape as PropertyBill.lineItems (jsonb array), kept
-- as a plain jsonb array of {fileName, fileData} objects rather than a new child table since it's
-- always read/written whole alongside its parent expense, never queried independently.
ALTER TABLE public.expenses ADD COLUMN "additionalFiles" jsonb;
