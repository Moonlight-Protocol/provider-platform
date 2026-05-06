CREATE TABLE IF NOT EXISTS "waitlist_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"wallet_public_key" text,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_waitlist_wallet" ON "waitlist_requests" USING btree ("wallet_public_key");
