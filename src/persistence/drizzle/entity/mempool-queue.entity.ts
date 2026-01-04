import { pgTable, text, pgEnum, timestamp } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createBaseColumns } from "@/persistence/drizzle/entity/base.entity.ts";
import { transaction } from "@/persistence/drizzle/entity/transaction.entity.ts";
import { mempoolSlot } from "@/persistence/drizzle/entity/mempool-slot.entity.ts";

export enum MempoolQueueStatus {
  PENDING = "PENDING",
  PROCESSING = "PROCESSING",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
}

export const mempoolQueueStatusEnum = pgEnum("mempool_queue_status", [
  MempoolQueueStatus.PENDING,
  MempoolQueueStatus.PROCESSING,
  MempoolQueueStatus.COMPLETED,
  MempoolQueueStatus.FAILED,
]);

export const mempoolQueue = pgTable("mempool_queue", {
  id: text("id").primaryKey(),
  status: mempoolQueueStatusEnum("status").notNull(),
  transactionId: text("transaction_id").references(() => transaction.id),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  ...createBaseColumns(),
});

// Relations
export const mempoolQueueRelations = relations(mempoolQueue, ({ one, many }) => ({
  transaction: one(transaction, {
    fields: [mempoolQueue.transactionId],
    references: [transaction.id],
  }),
  slots: many(mempoolSlot),
}));

export type MempoolQueue = typeof mempoolQueue.$inferSelect;
export type NewMempoolQueue = typeof mempoolQueue.$inferInsert;

