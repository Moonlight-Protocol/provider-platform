import { bigint, index, pgEnum, pgTable, text } from "drizzle-orm/pg-core";
import { createBaseColumns } from "@/persistence/drizzle/entity/base.entity.ts";

export enum PayCustodialStatus {
  ACTIVE = "ACTIVE",
  SUSPENDED = "SUSPENDED",
}

export const payCustodialStatusEnum = pgEnum("pay_custodial_status", [
  PayCustodialStatus.ACTIVE,
  PayCustodialStatus.SUSPENDED,
]);

export const payCustodialAccount = pgTable("pay_custodial_accounts", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  depositAddress: text("deposit_address").notNull(),
  balance: bigint("balance", { mode: "bigint" }).notNull().$default(() => 0n),
  status: payCustodialStatusEnum("status").notNull().default(
    PayCustodialStatus.ACTIVE,
  ),
  ...createBaseColumns(),
}, (table) => [
  index("idx_pay_custodial_username").on(table.username),
]);

export type PayCustodialAccount = typeof payCustodialAccount.$inferSelect;
export type NewPayCustodialAccount = typeof payCustodialAccount.$inferInsert;
