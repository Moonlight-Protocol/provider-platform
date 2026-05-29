import { pgEnum, pgTable, text } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createBaseColumns } from "@/persistence/drizzle/entity/base.entity.ts";
import { account } from "@/persistence/drizzle/entity/account.entity.ts";
import { challenge } from "@/persistence/drizzle/entity/challenge.entity.ts";

export enum EntityStatus {
  UNVERIFIED = "UNVERIFIED",
  APPROVED = "APPROVED",
  PENDING = "PENDING",
  BLOCKED = "BLOCKED",
}

export const entityStatusEnum = pgEnum("entity_status", [
  EntityStatus.UNVERIFIED,
  EntityStatus.APPROVED,
  EntityStatus.PENDING,
  EntityStatus.BLOCKED,
]);

export const entity = pgTable("entities", {
  id: text("id").primaryKey(),
  status: entityStatusEnum("status").notNull(),
  name: text("name"),
  jurisdictions: text("jurisdictions").array(),
  ...createBaseColumns(),
});

// Relations
export const entityRelations = relations(entity, ({ many }) => ({
  accounts: many(account),
  challenges: many(challenge),
}));

export type Entity = typeof entity.$inferSelect;
export type NewEntity = typeof entity.$inferInsert;
