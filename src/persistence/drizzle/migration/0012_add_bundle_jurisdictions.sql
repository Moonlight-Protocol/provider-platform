-- Optional from/to jurisdiction tags on bundles. Senders pass these at submit
-- time so the dashboard can surface jurisdiction context per tx without the
-- provider having to infer it from operation data.
ALTER TABLE operations_bundles ADD COLUMN IF NOT EXISTS jurisdiction_from TEXT;
ALTER TABLE operations_bundles ADD COLUMN IF NOT EXISTS jurisdiction_to TEXT;
