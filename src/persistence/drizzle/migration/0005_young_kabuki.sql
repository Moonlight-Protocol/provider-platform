CREATE TABLE "mempool_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"platform_version" text NOT NULL,
	"queue_depth" integer NOT NULL,
	"slot_count" integer NOT NULL,
	"bundles_completed" integer DEFAULT 0 NOT NULL,
	"bundles_expired" integer DEFAULT 0 NOT NULL,
	"avg_processing_ms" double precision,
	"p95_processing_ms" double precision,
	"throughput_per_min" double precision
);
--> statement-breakpoint
CREATE INDEX "idx_mempool_metrics_recorded_at" ON "mempool_metrics" USING btree ("recorded_at");
--> statement-breakpoint
CREATE INDEX "idx_mempool_metrics_version" ON "mempool_metrics" USING btree ("platform_version");
--> statement-breakpoint
CREATE INDEX "idx_bundles_status_updated" ON "operations_bundles" USING btree ("status","deleted_at","updated_at");
