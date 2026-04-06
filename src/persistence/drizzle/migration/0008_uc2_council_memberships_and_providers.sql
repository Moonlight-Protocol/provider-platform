CREATE TYPE "public"."council_membership_status" AS ENUM('PENDING', 'ACTIVE', 'REJECTED');--> statement-breakpoint
CREATE TABLE "council_memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"council_url" text NOT NULL,
	"council_name" text,
	"council_public_key" text NOT NULL,
	"channel_auth_id" text NOT NULL,
	"status" "council_membership_status" NOT NULL,
	"config_json" text,
	"join_request_id" text,
	"pp_public_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payment_providers" (
	"id" text PRIMARY KEY NOT NULL,
	"public_key" text NOT NULL,
	"encrypted_sk" text NOT NULL,
	"derivation_index" integer NOT NULL,
	"owner_public_key" text,
	"is_active" boolean DEFAULT false NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "payment_providers_public_key_unique" UNIQUE("public_key")
);
CREATE INDEX IF NOT EXISTS "idx_pp_owner" ON "payment_providers" ("owner_public_key");
--> statement-breakpoint
CREATE TABLE "wallet_users" (
	"public_key" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "operations_bundles" ADD COLUMN IF NOT EXISTS "channel_contract_id" text;

