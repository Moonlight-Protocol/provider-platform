import { eq, and, isNull } from "drizzle-orm";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import {
  bundleTransaction,
  type BundleTransaction,
  type NewBundleTransaction,
} from "@/persistence/drizzle/entity/bundle-transaction.entity.ts";
import { BaseRepository } from "@/persistence/drizzle/repository/base.repository.ts";

export class BundleTransactionRepository extends BaseRepository<
  typeof bundleTransaction,
  BundleTransaction,
  NewBundleTransaction
> {
  constructor() {
    super(drizzleClient, bundleTransaction);
  }

  /**
   * Finds records by bundle_id
   */
  async findByBundleId(bundleId: string) {
    return await this.db
      .select()
      .from(bundleTransaction)
      .where(
        and(
          eq(bundleTransaction.bundleId, bundleId),
          isNull(bundleTransaction.deletedAt)
        )
      );
  }

  /**
   * Finds records by transaction_id
   */
  async findByTransactionId(transactionId: string) {
    return await this.db
      .select()
      .from(bundleTransaction)
      .where(
        and(
          eq(bundleTransaction.transactionId, transactionId),
          isNull(bundleTransaction.deletedAt)
        )
      );
  }

  /**
   * Override findById to handle composite primary key
   */
  async findById(bundleId: string, transactionId: string) {
    const [result] = await this.db
      .select()
      .from(bundleTransaction)
      .where(
        and(
          eq(bundleTransaction.bundleId, bundleId),
          eq(bundleTransaction.transactionId, transactionId),
          isNull(bundleTransaction.deletedAt)
        )
      )
      .limit(1);
    return result;
  }

  /**
   * Override delete to handle composite primary key
   */
  async delete(bundleId: string, transactionId: string): Promise<void> {
    await this.db
      .update(bundleTransaction)
      .set({
        deletedAt: new Date(),
      } as any)
      .where(
        and(
          eq(bundleTransaction.bundleId, bundleId),
          eq(bundleTransaction.transactionId, transactionId)
        )
      );
  }
}

