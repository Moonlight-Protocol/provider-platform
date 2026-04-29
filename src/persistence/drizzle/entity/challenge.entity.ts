import { pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createBaseColumns } from "@/persistence/drizzle/entity/base.entity.ts";
import { account } from "@/persistence/drizzle/entity/account.entity.ts";

export enum ChallengeStatus {
  VERIFIED = "VERIFIED",
  UNVERIFIED = "UNVERIFIED",
}

export const challengeStatusEnum = pgEnum("challenge_status", [
  ChallengeStatus.VERIFIED,
  ChallengeStatus.UNVERIFIED,
]);

export const challenge = pgTable("challenges", {
  id: text("id").primaryKey(),
  accountId: text("account_id")
    .notNull()
    .references(() => account.id),
  status: challengeStatusEnum("status").notNull(),
  ttl: timestamp("ttl", { withTimezone: true }).notNull(),
  txHash: text("tx_hash").notNull().unique(),
  txXDR: text("tx_xdr").notNull(),
  ...createBaseColumns(),
});

// Relations
export const challengeRelations = relations(challenge, ({ one }) => ({
  account: one(account, {
    fields: [challenge.accountId],
    references: [account.id],
  }),
}));

export type Challenge = typeof challenge.$inferSelect;
export type NewChallenge = typeof challenge.$inferInsert;
