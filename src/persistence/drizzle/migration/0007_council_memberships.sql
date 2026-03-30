-- UC2: Council membership tracking
DO $$ BEGIN
  CREATE TYPE council_membership_status AS ENUM ('PENDING', 'ACTIVE', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS council_memberships (
  id TEXT PRIMARY KEY,
  council_url TEXT NOT NULL,
  council_name TEXT,
  council_public_key TEXT NOT NULL,
  channel_auth_id TEXT NOT NULL,
  status council_membership_status NOT NULL DEFAULT 'PENDING',
  config_json TEXT,
  join_request_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT,
  updated_by TEXT,
  deleted_at TIMESTAMPTZ
);
