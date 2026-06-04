import { and, eq, isNull } from "drizzle-orm";
import type { DrizzleClient } from "@/persistence/drizzle/config.ts";
import {
  type NewPpEntityApproval,
  type PpEntityApproval,
  ppEntityApproval,
} from "@/persistence/drizzle/entity/pp-entity-approval.entity.ts";
import { BaseRepository } from "@/persistence/drizzle/repository/base.repository.ts";

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
}
