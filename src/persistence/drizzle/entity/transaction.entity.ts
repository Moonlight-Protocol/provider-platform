import { pgTable, text, pgEnum, timestamp } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createBaseColumns } from "@/persistence/drizzle/entity/base.entity.ts";
import { bundleTransaction } from "@/persistence/drizzle/entity/bundle-transaction.entity.ts";
import { utxo } from "@/persistence/drizzle/entity/utxo.entity.ts";
import { mempoolQueue } from "@/persistence/drizzle/entity/mempool-queue.entity.ts";

export enum TransactionStatus {
  UNVERIFIED = "UNVERIFIED",
  VERIFIED = "VERIFIED",
}

export const transactionStatusEnum = pgEnum("transaction_status", [
  TransactionStatus.UNVERIFIED,
  TransactionStatus.VERIFIED,
]);

export const transaction = pgTable("transactions", {
  id: text("id").primaryKey(),
  status: transactionStatusEnum("status").notNull(),
  timeout: timestamp("timeout", { withTimezone: true }).notNull(),
  ledgerSequence: text("ledger_sequence").notNull(),
  mempoolQueueId: text("mempool_queue_id"), // Foreign key defined in migration to avoid circular reference
  ...createBaseColumns(),
});

// Relations
export const transactionRelations = relations(transaction, ({ one, many }) => ({
  mempoolQueue: one(mempoolQueue, {
    fields: [transaction.mempoolQueueId],
    references: [mempoolQueue.id],
  }),
  bundleTransactions: many(bundleTransaction),
  utxos: many(utxo),
}));

export type Transaction = typeof transaction.$inferSelect;
export type NewTransaction = typeof transaction.$inferInsert;

