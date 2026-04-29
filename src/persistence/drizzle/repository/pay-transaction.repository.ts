import { and, count, desc, eq, isNull } from "drizzle-orm";
import type { DrizzleClient } from "@/persistence/drizzle/config.ts";
import {
  type NewPayTransaction,
  type PayTransaction,
  payTransaction,
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

  async countByAccountId(
    accountId: string,
    opts?: { status?: PayTransactionStatus },
  ): Promise<number> {
    const conditions = [
      eq(payTransaction.accountId, accountId),
      isNull(payTransaction.deletedAt),
    ];
    if (opts?.status) {
      conditions.push(eq(payTransaction.status, opts.status));
    }

    const [result] = await this.db
      .select({ count: count() })
      .from(payTransaction)
      .where(and(...conditions));
    return result?.count ?? 0;
  }
}
