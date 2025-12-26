import { pgTable, text, pgEnum, timestamp, jsonb } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createBaseColumns } from "@/persistence/drizzle/entity/base.entity.ts";
import { bundleTransaction } from "@/persistence/drizzle/entity/bundle-transaction.entity.ts";

export enum BundleStatus {
  PENDING = "PENDING",
  PROCESSING = "PROCESSING",
  EXPIRED = "EXPIRED",
  COMPLETED = "COMPLETED",
}

export const bundleStatusEnum = pgEnum("bundle_status", [
  BundleStatus.PENDING,
  BundleStatus.PROCESSING,
  BundleStatus.EXPIRED,
  BundleStatus.COMPLETED,
]);

export const operationsBundle = pgTable("operations_bundles", {
  id: text("id").primaryKey(),
  status: bundleStatusEnum("status").notNull(),
  ttl: timestamp("ttl", { withTimezone: true }).notNull(),
  operationsMLXDR: jsonb("operations_mlxdr").$type<string[]>().notNull(),
  ...createBaseColumns(),
});

// Relations
export const operationsBundleRelations = relations(
  operationsBundle,
  ({ many }) => ({
    bundleTransactions: many(bundleTransaction),
  })
);

export type OperationsBundle = typeof operationsBundle.$inferSelect;
export type NewOperationsBundle = typeof operationsBundle.$inferInsert;

