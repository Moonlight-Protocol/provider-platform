import { pgTable, text, pgEnum } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createBaseColumns } from "@/persistence/drizzle/entity/base.entity.ts";
import { account } from "@/persistence/drizzle/entity/account.entity.ts";

export enum SessionStatus {
  ACTIVE = "ACTIVE",
  INACTIVE = "INACTIVE",
}

export const sessionStatusEnum = pgEnum("session_status", [
  SessionStatus.ACTIVE,
  SessionStatus.INACTIVE,
]);

export const session = pgTable("sessions", {
  id: text("id").primaryKey(),
  status: sessionStatusEnum("status").notNull(),
  jwtToken: text("jwt_token"),
  accountId: text("account_id")
    .notNull()
    .references(() => account.id),
  ...createBaseColumns(),
});

// Relations
export const sessionRelations = relations(session, ({ one }) => ({
  account: one(account, {
    fields: [session.accountId],
    references: [account.id],
  }),
}));

export type Session = typeof session.$inferSelect;
export type NewSession = typeof session.$inferInsert;

