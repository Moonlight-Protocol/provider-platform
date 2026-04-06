import { pgTable, text, boolean, integer } from "drizzle-orm/pg-core";
import { createBaseColumns } from "@/persistence/drizzle/entity/base.entity.ts";

export const paymentProvider = pgTable("payment_providers", {
  id: text("id").primaryKey(),
  publicKey: text("public_key").notNull().unique(),
  encryptedSk: text("encrypted_sk").notNull(),
  derivationIndex: integer("derivation_index").notNull(),
  ownerPublicKey: text("owner_public_key"),
  isActive: boolean("is_active").notNull().default(false),
  label: text("label"),
  ...createBaseColumns(),
});

export type PaymentProvider = typeof paymentProvider.$inferSelect;
export type NewPaymentProvider = typeof paymentProvider.$inferInsert;
