ALTER TYPE "public"."bundle_status" ADD VALUE IF NOT EXISTS 'FAILED';--> statement-breakpoint
ALTER TABLE "operations_bundles" ADD COLUMN IF NOT EXISTS "retry_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "operations_bundles" ADD COLUMN IF NOT EXISTS "last_failure_reason" text;
