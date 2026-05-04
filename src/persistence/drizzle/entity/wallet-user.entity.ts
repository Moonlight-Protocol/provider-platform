import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const walletUser = pgTable("wallet_users", {
  publicKey: text("public_key").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
    .defaultNow(),
});

export type WalletUser = typeof walletUser.$inferSelect;
export type NewWalletUser = typeof walletUser.$inferInsert;
