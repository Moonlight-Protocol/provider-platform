-- Track the PP's claimed jurisdictions at join time so we can surface them
-- even when the membership is still PENDING/REJECTED (before the council's
-- public config is cached).
ALTER TABLE council_memberships ADD COLUMN IF NOT EXISTS claimed_jurisdictions TEXT;
