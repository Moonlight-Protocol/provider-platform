-- Create enum for mempool queue status
CREATE TYPE "public"."mempool_queue_status" AS ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');
--> statement-breakpoint

-- Create mempool_queue table
CREATE TABLE "mempool_queue" (
	"id" text PRIMARY KEY NOT NULL,
	"status" "mempool_queue_status" NOT NULL,
	"transaction_id" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "mempool_queue_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint

-- Create mempool_slots table
CREATE TABLE "mempool_slots" (
	"id" text PRIMARY KEY NOT NULL,
	"mempool_queue_id" text NOT NULL,
	"slot_index" integer NOT NULL,
	"bundle_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "mempool_slots_mempool_queue_id_mempool_queue_id_fk" FOREIGN KEY ("mempool_queue_id") REFERENCES "public"."mempool_queue"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "mempool_slots_bundle_id_operations_bundles_id_fk" FOREIGN KEY ("bundle_id") REFERENCES "public"."operations_bundles"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint

-- Add mempool_queue_id column to transactions table
ALTER TABLE "transactions" ADD COLUMN "mempool_queue_id" text;
--> statement-breakpoint

-- Add foreign key constraint for mempool_queue_id in transactions
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_mempool_queue_id_mempool_queue_id_fk" FOREIGN KEY ("mempool_queue_id") REFERENCES "public"."mempool_queue"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS "mempool_queue_status_idx" ON "mempool_queue"("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mempool_queue_created_at_idx" ON "mempool_queue"("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mempool_slots_mempool_queue_id_idx" ON "mempool_slots"("mempool_queue_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mempool_slots_bundle_id_idx" ON "mempool_slots"("bundle_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transactions_mempool_queue_id_idx" ON "transactions"("mempool_queue_id");

