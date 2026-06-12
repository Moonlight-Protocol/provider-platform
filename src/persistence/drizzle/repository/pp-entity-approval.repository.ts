import { and, desc, eq, isNull } from "drizzle-orm";
import type { DrizzleClient } from "@/persistence/drizzle/config.ts";
import {
  type NewPpEntityApproval,
  type PpEntityApproval,
  ppEntityApproval,
} from "@/persistence/drizzle/entity/pp-entity-approval.entity.ts";
import { account } from "@/persistence/drizzle/entity/account.entity.ts";
import { entity } from "@/persistence/drizzle/entity/entity.entity.ts";
import { EntityStatus } from "@/persistence/drizzle/entity/entity.entity.ts";
import { BaseRepository } from "@/persistence/drizzle/repository/base.repository.ts";

/** One row of {@link PpEntityApprovalRepository.listByPp}. Identity fields are
 * null when the pubkey has interacted but has no entity record (e.g. an
 * unauthorized connect that never registered via KYC). */
export interface PpEntityListRow {
  accountPubkey: string;
  status: EntityStatus;
  name: string | null;
  jurisdictions: string[] | null;
  createdAt: Date;
  updatedAt: Date;
}

export class PpEntityApprovalRepository extends BaseRepository<
  typeof ppEntityApproval,
  PpEntityApproval,
  NewPpEntityApproval
> {
  constructor(db: DrizzleClient) {
    super(db, ppEntityApproval);
  }

  async findByPpAndAccount(
    ppPublicKey: string,
    accountPubkey: string,
  ): Promise<PpEntityApproval | undefined> {
    const [row] = await this.db
      .select()
      .from(ppEntityApproval)
      .where(
        and(
          eq(ppEntityApproval.ppPublicKey, ppPublicKey),
          eq(ppEntityApproval.accountPubkey, accountPubkey),
          isNull(ppEntityApproval.deletedAt),
        ),
      )
      .limit(1);
    return row;
  }

  /**
   * Records that `(ppPublicKey, accountPubkey)` interacted with the provider.
   * Locked write-invariant (never downgrades an approved/pending/blocked row):
   *   - no row            → insert { status: UNVERIFIED, created_at = updated_at = now }
   *   - row is UNVERIFIED → bump updated_at = now only (status untouched)
   *   - row APPROVED/PENDING/BLOCKED → DO NOTHING (status + timestamps untouched)
   *
   * Single atomic upsert keyed on the (pp_public_key, account_pubkey) unique
   * index; the `setWhere` clause confines the touch to UNVERIFIED rows so a
   * conflicting APPROVED/PENDING/BLOCKED row is left entirely alone.
   */
  async recordInteraction(
    ppPublicKey: string,
    accountPubkey: string,
  ): Promise<void> {
    await this.db
      .insert(ppEntityApproval)
      .values({
        id: crypto.randomUUID(),
        ppPublicKey,
        accountPubkey,
        status: EntityStatus.UNVERIFIED,
      })
      .onConflictDoUpdate({
        target: [ppEntityApproval.ppPublicKey, ppEntityApproval.accountPubkey],
        set: { updatedAt: new Date() },
        setWhere: eq(ppEntityApproval.status, EntityStatus.UNVERIFIED),
      });
  }

  /**
   * All non-deleted approval rows for a PP, joined to entity identity
   * (name / jurisdictions) via account → entity where it exists, newest
   * interaction first (updated_at DESC). Identity fields are null for pubkeys
   * with no entity record.
   */
  async listByPp(ppPublicKey: string): Promise<PpEntityListRow[]> {
    return await this.db
      .select({
        accountPubkey: ppEntityApproval.accountPubkey,
        status: ppEntityApproval.status,
        name: entity.name,
        jurisdictions: entity.jurisdictions,
        createdAt: ppEntityApproval.createdAt,
        updatedAt: ppEntityApproval.updatedAt,
      })
      .from(ppEntityApproval)
      .leftJoin(account, eq(account.id, ppEntityApproval.accountPubkey))
      .leftJoin(entity, eq(entity.id, account.entityId))
      .where(
        and(
          eq(ppEntityApproval.ppPublicKey, ppPublicKey),
          isNull(ppEntityApproval.deletedAt),
        ),
      )
      .orderBy(desc(ppEntityApproval.updatedAt)) as PpEntityListRow[];
  }
}
