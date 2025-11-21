import { eq, and, isNull } from "drizzle-orm";
import type { DrizzleClient } from "@/persistence/drizzle/config.ts";
import { account, type Account, type NewAccount, type AccountType } from "@/persistence/drizzle/entity/account.entity.ts";
import { BaseRepository } from "@/persistence/drizzle/repository/base.repository.ts";

export class AccountRepository extends BaseRepository<
  typeof account,
  Account,
  NewAccount
> {
  constructor(db: DrizzleClient) {
    super(db, account);
  }

  /**
   * Finds accounts by user_id
   */
  async findByUserId(userId: string) {
    return await this.db
      .select()
      .from(account)
      .where(
        and(
          eq(account.userId, userId),
          isNull(account.deletedAt)
        )
      );
  }

  /**
   * Finds accounts by type
   */
  async findByType(type: "OPEX" | "USER") {
    return await this.db
      .select()
      .from(account)
      .where(
        and(
          eq(account.type, type as AccountType),
          isNull(account.deletedAt)
        )
      );
  }
}

