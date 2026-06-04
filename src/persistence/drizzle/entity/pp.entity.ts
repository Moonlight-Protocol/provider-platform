import { boolean, integer, pgTable, text } from "drizzle-orm/pg-core";
import { createBaseColumns } from "@/persistence/drizzle/entity/base.entity.ts";

export const paymentProvider = pgTable("payment_providers", {
  id: text("id").primaryKey(),
  publicKey: text("public_key").notNull().unique(),
  encryptedSk: text("encrypted_sk").notNull(),
  derivationIndex: integer("derivation_index").notNull(),
  ownerPublicKey: text("owner_public_key"),
  isActive: boolean("is_active").notNull().default(false),
  label: text("label"),
  // Optional. When set, the wallet renders a "Submit KYC" link pointing at
  // this URL whenever the submitter's per-PP entity status is not APPROVED.
  // Operator-owned (different PP operators may use different schemes), so
  // the wallet uses the stored string verbatim.
  kycSubmissionUrl: text("kyc_submission_url"),
  ...createBaseColumns(),
});

export type PaymentProvider = typeof paymentProvider.$inferSelect;
export type NewPaymentProvider = typeof paymentProvider.$inferInsert;
