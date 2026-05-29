import { pgEnum, pgTable, text } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createBaseColumns } from "@/persistence/drizzle/entity/base.entity.ts";
import { entity } from "@/persistence/drizzle/entity/entity.entity.ts";
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
  entityId: text("entity_id")
    .notNull()
    .references(() => entity.id),
  ...createBaseColumns(),
});

// Relations
export const accountRelations = relations(account, ({ one, many }) => ({
  entity: one(entity, {
    fields: [account.entityId],
    references: [entity.id],
  }),
  utxos: many(utxo),
}));

export type Account = typeof account.$inferSelect;
export type NewAccount = typeof account.$inferInsert;
