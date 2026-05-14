ALTER TABLE "mempool_metrics" ADD COLUMN "pp_public_key" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_mempool_metrics_pp_recorded" ON "mempool_metrics" USING btree ("pp_public_key","recorded_at");
