import { pgEnum, pgTable, text } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createBaseColumns } from "@/persistence/drizzle/entity/base.entity.ts";
import { account } from "@/persistence/drizzle/entity/account.entity.ts";
import { challenge } from "@/persistence/drizzle/entity/challenge.entity.ts";

// Identity-level status enum reused by `pp_entity_approvals.status` to gate
// bundle submission per PP. The global `entities` table owns identity
// (name, jurisdictions) only — there is no global status column anymore.
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
