import {
  doublePrecision,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const mempoolMetric = pgTable("mempool_metrics", {
  id: serial("id").primaryKey(),
  recordedAt: timestamp("recorded_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  platformVersion: text("platform_version").notNull(),

  // Per-PP attribution. Nullable so historical rows (pre-0010 migration) remain
  // visible to the schema but are excluded from per-PP dashboard queries.
  ppPublicKey: text("pp_public_key"),

  // Snapshot of queue state at recording time
  queueDepth: integer("queue_depth").notNull(),
  slotCount: integer("slot_count").notNull(),

  // Counts within the collection window
  bundlesCompleted: integer("bundles_completed").notNull().default(0),
  bundlesExpired: integer("bundles_expired").notNull().default(0),
  bundlesFailed: integer("bundles_failed").notNull().default(0),

  // Timing averages (ms) for bundles completed in the window
  avgProcessingMs: doublePrecision("avg_processing_ms"),
  p95ProcessingMs: doublePrecision("p95_processing_ms"),

  // Throughput
  throughputPerMin: doublePrecision("throughput_per_min"),
}, (table) => [
  index("idx_mempool_metrics_recorded_at").on(table.recordedAt),
  index("idx_mempool_metrics_version").on(table.platformVersion),
  index("idx_mempool_metrics_pp_recorded").on(
    table.ppPublicKey,
    table.recordedAt,
  ),
]);

export type MempoolMetric = typeof mempoolMetric.$inferSelect;
export type NewMempoolMetric = typeof mempoolMetric.$inferInsert;
