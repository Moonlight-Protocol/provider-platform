import { pgTable, text, pgEnum } from "drizzle-orm/pg-core";
import { createBaseColumns } from "@/persistence/drizzle/entity/base.entity.ts";

export enum CouncilMembershipStatus {
  PENDING = "PENDING",
  ACTIVE = "ACTIVE",
  REJECTED = "REJECTED",
}

export const councilMembershipStatusEnum = pgEnum("council_membership_status", [
  CouncilMembershipStatus.PENDING,
  CouncilMembershipStatus.ACTIVE,
  CouncilMembershipStatus.REJECTED,
]);

export const councilMembership = pgTable("council_memberships", {
  id: text("id").primaryKey(),
  councilUrl: text("council_url").notNull(),
  councilName: text("council_name"),
  councilPublicKey: text("council_public_key").notNull(),
  channelAuthId: text("channel_auth_id").notNull(),
  status: councilMembershipStatusEnum("status").notNull(),
  configJson: text("config_json"),
  joinRequestId: text("join_request_id"),
  ppPublicKey: text("pp_public_key").notNull(),
  ...createBaseColumns(),
});

export type CouncilMembership = typeof councilMembership.$inferSelect;
export type NewCouncilMembership = typeof councilMembership.$inferInsert;
