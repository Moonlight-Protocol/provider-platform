import { eq, and, isNull, desc, count } from "drizzle-orm";
import type { DrizzleClient } from "@/persistence/drizzle/config.ts";
import {
  payTransaction,
  type PayTransaction,
  type NewPayTransaction,
  type PayTransactionStatus,
} from "@/persistence/drizzle/entity/pay-transaction.entity.ts";
import { BaseRepository } from "@/persistence/drizzle/repository/base.repository.ts";

export class PayTransactionRepository extends BaseRepository<
  typeof payTransaction,
  PayTransaction,
  NewPayTransaction
> {
  constructor(db: DrizzleClient) {
    super(db, payTransaction);
  }

  async findByAccountId(
    accountId: string,
    opts?: { limit?: number; offset?: number; status?: PayTransactionStatus },
  ): Promise<PayTransaction[]> {
    const conditions = [
      eq(payTransaction.accountId, accountId),
      isNull(payTransaction.deletedAt),
    ];
    if (opts?.status) {
      conditions.push(eq(payTransaction.status, opts.status));
    }

    return await this.db
      .select()
      .from(payTransaction)
      .where(and(...conditions))
      .orderBy(desc(payTransaction.createdAt))
      .limit(opts?.limit ?? 50)
      .offset(opts?.offset ?? 0);
  }

  async countByAccountId(accountId: string): Promise<number> {
    const [result] = await this.db
      .select({ count: count() })
      .from(payTransaction)
      .where(
        and(
          eq(payTransaction.accountId, accountId),
          isNull(payTransaction.deletedAt),
        )
      );
    return result?.count ?? 0;
  }
}
