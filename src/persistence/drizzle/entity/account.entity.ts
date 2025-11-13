import { pgTable, text, pgEnum } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createBaseColumns } from "@/persistence/drizzle/entity/base.entity.ts";
import { user } from "@/persistence/drizzle/entity/user.entity.ts";
import { utxo } from "@/persistence/drizzle/entity/utxo.entity.ts";

export enum AccountType {
  OPEX = "OPEX",
  USER = "USER",
}

export const accountTypeEnum = pgEnum("account_type", [
  AccountType.OPEX,
  AccountType.USER,
]);

export const account = pgTable("accounts", {
  id: text("id").primaryKey(),
  type: accountTypeEnum("type").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id),
  ...createBaseColumns(),
});

// Relations
export const accountRelations = relations(account, ({ one, many }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
  utxos: many(utxo),
}));

export type Account = typeof account.$inferSelect;
export type NewAccount = typeof account.$inferInsert;

