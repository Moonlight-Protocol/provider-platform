import { eq, and, isNull, lt } from "drizzle-orm";
import type { DrizzleClient } from "@/persistence/drizzle/config.ts";
import { challenge, type Challenge, type NewChallenge } from "@/persistence/drizzle/entity/challenge.entity.ts";
import { BaseRepository } from "@/persistence/drizzle/repository/base.repository.ts";

export class ChallengeRepository extends BaseRepository<
  typeof challenge,
  Challenge,
  NewChallenge
> {
  constructor(db: DrizzleClient) {
    super(db, challenge);
  }

  /**
   * Finds challenge by tx_hash
   */
  async findOneByTxHash(txHash: string): Promise<Challenge | undefined> {
    const [result] = await this.db
      .select()
      .from(challenge)
      .where(eq(challenge.txHash, txHash))
      .limit(1);
    return result as Challenge | undefined;
  }

  /**
   * Finds challenges by account_id
   */
  async findByAccountId(accountId: string): Promise<Challenge[]> {
    const results = await this.db
      .select()
      .from(challenge)
      .where(
        and(
          eq(challenge.accountId, accountId),
          isNull(challenge.deletedAt)
        )
      );
    return results as Challenge[];
  }

  /**
   * Finds expired challenges
   */
  async findExpired() {
    const now = new Date();
    return await this.db
      .select()
      .from(challenge)
      .where(
        and(
          lt(challenge.ttl, now),
          isNull(challenge.deletedAt)
        )
      );
  }
}

