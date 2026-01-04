import { pgTable, text, integer } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createBaseColumns } from "@/persistence/drizzle/entity/base.entity.ts";
import { mempoolQueue } from "@/persistence/drizzle/entity/mempool-queue.entity.ts";
import { operationsBundle } from "@/persistence/drizzle/entity/operations-bundle.entity.ts";

export const mempoolSlot = pgTable("mempool_slots", {
  id: text("id").primaryKey(),
  mempoolQueueId: text("mempool_queue_id")
    .notNull()
    .references(() => mempoolQueue.id),
  slotIndex: integer("slot_index").notNull(), // Position of the slot (0-based)
  bundleId: text("bundle_id")
    .notNull()
    .references(() => operationsBundle.id),
  ...createBaseColumns(),
});

// Relations
export const mempoolSlotRelations = relations(mempoolSlot, ({ one }) => ({
  mempoolQueue: one(mempoolQueue, {
    fields: [mempoolSlot.mempoolQueueId],
    references: [mempoolQueue.id],
  }),
  bundle: one(operationsBundle, {
    fields: [mempoolSlot.bundleId],
    references: [operationsBundle.id],
  }),
}));

export type MempoolSlot = typeof mempoolSlot.$inferSelect;
export type NewMempoolSlot = typeof mempoolSlot.$inferInsert;

