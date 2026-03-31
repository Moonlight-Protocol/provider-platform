import { pgTable, text, pgEnum, timestamp, index } from "drizzle-orm/pg-core";
import { createBaseColumns } from "@/persistence/drizzle/entity/base.entity.ts";

export enum PayKycStatus {
  NONE = "NONE",
  PENDING = "PENDING",
  VERIFIED = "VERIFIED",
}

export const payKycStatusEnum = pgEnum("pay_kyc_status", [
  PayKycStatus.NONE,
  PayKycStatus.PENDING,
  PayKycStatus.VERIFIED,
]);

export const payKyc = pgTable("pay_kyc", {
  id: text("id").primaryKey(),
  address: text("address").notNull().unique(),
  status: payKycStatusEnum("status").notNull().default(PayKycStatus.NONE),
  jurisdiction: text("jurisdiction"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  ...createBaseColumns(),
}, (table) => [
  index("idx_pay_kyc_address").on(table.address),
]);

export type PayKyc = typeof payKyc.$inferSelect;
export type NewPayKyc = typeof payKyc.$inferInsert;
