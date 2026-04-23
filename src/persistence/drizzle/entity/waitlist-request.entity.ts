import { pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createBaseColumns } from "@/persistence/drizzle/entity/base.entity.ts";

export const waitlistRequest = pgTable("waitlist_requests", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  walletPublicKey: text("wallet_public_key"),
  source: text("source").notNull(),
  ...createBaseColumns(),
}, (table) => [
  uniqueIndex("idx_waitlist_wallet").on(table.walletPublicKey),
]);

export type WaitlistRequest = typeof waitlistRequest.$inferSelect;
export type NewWaitlistRequest = typeof waitlistRequest.$inferInsert;
