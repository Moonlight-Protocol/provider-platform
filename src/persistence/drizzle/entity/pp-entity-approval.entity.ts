import { pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createBaseColumns } from "@/persistence/drizzle/entity/base.entity.ts";
import { entityStatusEnum } from "@/persistence/drizzle/entity/entity.entity.ts";

// Per-PP entity approval. Replaces the global entity.status as the gate for
// bundle submission: a wallet APPROVED on PP-A must not appear APPROVED on
// PP-B. The entity table still owns identity (name/jurisdictions) — only the
// per-PP status moves here.
export const ppEntityApproval = pgTable("pp_entity_approvals", {
  id: text("id").primaryKey(),
  ppPublicKey: text("pp_public_key").notNull(),
  accountPubkey: text("account_pubkey").notNull(),
  status: entityStatusEnum("status").notNull(),
  ...createBaseColumns(),
}, (t) => ({
  ppAccountUnique: uniqueIndex("pp_entity_approvals_pp_account_unique")
    .on(t.ppPublicKey, t.accountPubkey),
}));

export type PpEntityApproval = typeof ppEntityApproval.$inferSelect;
export type NewPpEntityApproval = typeof ppEntityApproval.$inferInsert;
