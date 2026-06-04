-- Per-PP entity approvals + per-PP KYC submission URL.
-- The global entity.status column is dropped in the same migration — no
-- bandaid column left for a future reader to misuse. Bundle gate now
-- queries pp_entity_approvals.status per (pp_public_key, account_pubkey).

ALTER TABLE "payment_providers" ADD COLUMN "kyc_submission_url" text;

ALTER TABLE "entities" DROP COLUMN "status";

CREATE TABLE "pp_entity_approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"pp_public_key" text NOT NULL,
	"account_pubkey" text NOT NULL,
	"status" "entity_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "pp_entity_approvals_pp_account_unique" UNIQUE("pp_public_key","account_pubkey")
);

CREATE INDEX IF NOT EXISTS "idx_pp_entity_approvals_lookup"
  ON "pp_entity_approvals" ("pp_public_key", "account_pubkey");
