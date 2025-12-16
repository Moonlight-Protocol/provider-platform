import { eq, and, isNull } from "drizzle-orm";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import {
  transaction,
  type Transaction,
  type NewTransaction,
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
          isNull(transaction.deletedAt)
        )
      );
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
          isNull(transaction.deletedAt)
        )
      )
      .limit(1);
    return result;
  }
}

