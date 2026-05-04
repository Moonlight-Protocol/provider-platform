import { bigint, pgTable, text } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createBaseColumns } from "@/persistence/drizzle/entity/base.entity.ts";
import { account } from "@/persistence/drizzle/entity/account.entity.ts";
import { operationsBundle } from "@/persistence/drizzle/entity/operations-bundle.entity.ts";

export const utxo = pgTable("utxos", {
  id: text("id").primaryKey(),
  amount: bigint("amount", { mode: "bigint" }).notNull(),
  accountId: text("account_id")
    .notNull()
    .references(() => account.id),
  spentByAccountId: text("spent_by_account_id"),
  createdAtBundleId: text("created_at_bundle_id").references(
    () => operationsBundle.id,
  ),
  spentAtBundleId: text("spent_at_bundle_id").references(
    () => operationsBundle.id,
  ),
  ...createBaseColumns(),
});

// Relations
export const utxoRelations = relations(utxo, ({ one }) => ({
  account: one(account, {
    fields: [utxo.accountId],
    references: [account.id],
  }),
  createdAtBundle: one(operationsBundle, {
    fields: [utxo.createdAtBundleId],
    references: [operationsBundle.id],
  }),
  spentAtBundle: one(operationsBundle, {
    fields: [utxo.spentAtBundleId],
    references: [operationsBundle.id],
  }),
}));

export type Utxo = typeof utxo.$inferSelect;
export type NewUtxo = typeof utxo.$inferInsert;
