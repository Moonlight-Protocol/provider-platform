import { pgTable, text, pgEnum, bigint, index } from "drizzle-orm/pg-core";
import { createBaseColumns } from "@/persistence/drizzle/entity/base.entity.ts";

export enum PayEscrowStatus {
  HELD = "HELD",
  CLAIMED = "CLAIMED",
  EXPIRED = "EXPIRED",
}

export const payEscrowStatusEnum = pgEnum("pay_escrow_status", [
  PayEscrowStatus.HELD,
  PayEscrowStatus.CLAIMED,
  PayEscrowStatus.EXPIRED,
]);

/**
 * Escrow records — funds held by the PP for an unverified receiver.
 *
 * When a send targets an address with no KYC, the PP creates UTXOs at
 * PP-controlled escrow addresses. This table tracks the mapping:
 * these UTXOs are held for Stellar address G...
 *
 * On KYC completion:
 * - Self-custodial: PP spends escrow UTXOs → creates at user-derived P256 addresses
 * - Custodial: funds stay PP-controlled, user sees balance
 */
export const payEscrow = pgTable("pay_escrow", {
  id: text("id").primaryKey(),
  heldForAddress: text("held_for_address").notNull(),
  senderAddress: text("sender_address").notNull(),
  amount: bigint("amount", { mode: "bigint" }).notNull(),
  assetCode: text("asset_code").notNull().default("XLM"),
  status: payEscrowStatusEnum("status").notNull().default(PayEscrowStatus.HELD),
  utxoPublicKeys: text("utxo_public_keys"), // JSON array of PP-controlled UTXO public keys
  bundleId: text("bundle_id"), // Bundle that created the escrow UTXOs
  claimBundleId: text("claim_bundle_id"), // Bundle that transferred to user UTXOs (on claim)
  mode: text("mode").notNull(), // 'self' or 'custodial'
  ...createBaseColumns(),
}, (table) => [
  index("idx_pay_escrow_held_for").on(table.heldForAddress, table.status),
  index("idx_pay_escrow_sender").on(table.senderAddress),
]);

export type PayEscrow = typeof payEscrow.$inferSelect;
export type NewPayEscrow = typeof payEscrow.$inferInsert;
