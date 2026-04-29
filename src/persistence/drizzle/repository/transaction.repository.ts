import { and, count, eq, isNull } from "drizzle-orm";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import {
  type NewTransaction,
  type Transaction,
  transaction,
} from "@/persistence/drizzle/entity/transaction.entity.ts";
import { BaseRepository } from "@/persistence/drizzle/repository/base.repository.ts";
import type { TransactionStatus } from "@/persistence/drizzle/entity/transaction.entity.ts";

export class TransactionRepository extends BaseRepository<
  typeof transaction,
  Transaction,
  NewTransaction
> {
  constructor() {
    super(drizzleClient, transaction);
  }

  /**
   * Finds transactions by status
   */
  async findByStatus(status: TransactionStatus) {
    return await this.db
      .select()
      .from(transaction)
      .where(
        and(
          eq(transaction.status, status),
          isNull(transaction.deletedAt),
        ),
      );
  }

  /**
   * Counts transactions by status
   */
  async countByStatus(status: TransactionStatus): Promise<number> {
    const [result] = await this.db
      .select({ count: count() })
      .from(transaction)
      .where(
        and(
          eq(transaction.status, status),
          isNull(transaction.deletedAt),
        ),
      );
    return result?.count ?? 0;
  }

  /**
   * Finds transaction by ledger_sequence
   */
  async findByLedgerSequence(ledgerSequence: string) {
    const [result] = await this.db
      .select()
      .from(transaction)
      .where(
        and(
          eq(transaction.ledgerSequence, ledgerSequence),
          isNull(transaction.deletedAt),
        ),
      )
      .limit(1);
    return result;
  }
}
