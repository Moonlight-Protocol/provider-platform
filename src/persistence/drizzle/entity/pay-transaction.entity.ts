import { pgTable, text, pgEnum, bigint, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createBaseColumns } from "@/persistence/drizzle/entity/base.entity.ts";
import { operationsBundle } from "@/persistence/drizzle/entity/operations-bundle.entity.ts";

export enum PayTransactionType {
  DEPOSIT = "DEPOSIT",
  WITHDRAW = "WITHDRAW",
  SEND = "SEND",
  RECEIVE = "RECEIVE",
}

export enum PayTransactionStatus {
  PENDING = "PENDING",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
  EXPIRED = "EXPIRED",
}

export const payTransactionTypeEnum = pgEnum("pay_transaction_type", [
  PayTransactionType.DEPOSIT,
  PayTransactionType.WITHDRAW,
  PayTransactionType.SEND,
  PayTransactionType.RECEIVE,
]);

export const payTransactionStatusEnum = pgEnum("pay_transaction_status", [
  PayTransactionStatus.PENDING,
  PayTransactionStatus.COMPLETED,
  PayTransactionStatus.FAILED,
  PayTransactionStatus.EXPIRED,
]);

export const payTransaction = pgTable("pay_transactions", {
  id: text("id").primaryKey(),
  type: payTransactionTypeEnum("type").notNull(),
  status: payTransactionStatusEnum("status").notNull(),
  amount: bigint("amount", { mode: "bigint" }).notNull(),
  assetCode: text("asset_code").notNull().default("XLM"),
  fromAddress: text("from_address"),
  toAddress: text("to_address"),
  jurisdictionFrom: text("jurisdiction_from"),
  jurisdictionTo: text("jurisdiction_to"),
  bundleId: text("bundle_id"),
  accountId: text("account_id").notNull(),
  mode: text("mode").notNull(), // 'self' or 'custodial'
  ...createBaseColumns(),
}, (table) => [
  index("idx_pay_tx_account_status").on(table.accountId, table.status),
  index("idx_pay_tx_account_created").on(table.accountId, table.createdAt),
]);

export const payTransactionRelations = relations(payTransaction, ({ one }) => ({
  bundle: one(operationsBundle, {
    fields: [payTransaction.bundleId],
    references: [operationsBundle.id],
  }),
}));

export type PayTransaction = typeof payTransaction.$inferSelect;
export type NewPayTransaction = typeof payTransaction.$inferInsert;
