import { text, timestamp } from "drizzle-orm/pg-core";

/**
 * Helper function to create base audit and soft delete fields
 * Reusable across all entities
 */
export const createBaseColumns = () => ({
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdBy: text("created_by"),
  updatedBy: text("updated_by"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});
