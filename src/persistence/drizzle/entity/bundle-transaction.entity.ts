import { pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createBaseColumns } from "@/persistence/drizzle/entity/base.entity.ts";
import { operationsBundle } from "@/persistence/drizzle/entity/operations-bundle.entity.ts";
import { transaction } from "@/persistence/drizzle/entity/transaction.entity.ts";

export const bundleTransaction = pgTable(
  "bundles_transactions",
  {
    bundleId: text("bundle_id")
      .notNull()
      .references(() => operationsBundle.id),
    transactionId: text("transaction_id")
      .notNull()
      .references(() => transaction.id),
    ...createBaseColumns(),
  },
  (table) => [
    primaryKey({ columns: [table.bundleId, table.transactionId] }),
  ],
);

// Relations
export const bundleTransactionRelations = relations(
  bundleTransaction,
  ({ one }) => ({
    bundle: one(operationsBundle, {
      fields: [bundleTransaction.bundleId],
      references: [operationsBundle.id],
    }),
    transaction: one(transaction, {
      fields: [bundleTransaction.transactionId],
      references: [transaction.id],
    }),
  }),
);

export type BundleTransaction = typeof bundleTransaction.$inferSelect;
export type NewBundleTransaction = typeof bundleTransaction.$inferInsert;
