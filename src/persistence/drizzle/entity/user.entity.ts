import { pgTable, text, pgEnum } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createBaseColumns } from "@/persistence/drizzle/entity/base.entity.ts";
import { account } from "@/persistence/drizzle/entity/account.entity.ts";
import { challenge } from "@/persistence/drizzle/entity/challenge.entity.ts";

export enum UserStatus {
  UNVERIFIED = "UNVERIFIED",
  APPROVED = "APPROVED",
  PENDING = "PENDING",
  BLOCKED = "BLOCKED",
}

export const userStatusEnum = pgEnum("user_status", [
  UserStatus.UNVERIFIED,
  UserStatus.APPROVED,
  UserStatus.PENDING,
  UserStatus.BLOCKED,
]);

export const user = pgTable("users", {
  id: text("id").primaryKey(),
  status: userStatusEnum("status").notNull(),
  ...createBaseColumns(),
});

// Relations
export const userRelations = relations(user, ({ many }) => ({
  accounts: many(account),
  challenges: many(challenge),
}));

export type User = typeof user.$inferSelect;
export type NewUser = typeof user.$inferInsert;

