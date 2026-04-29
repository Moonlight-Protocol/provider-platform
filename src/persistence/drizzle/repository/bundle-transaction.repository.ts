// deno-lint-ignore-file no-explicit-any
// TODO: Remove no-explicit-any after fixing Drizzle types
// unknown should be used instead of any where possible
import { and, eq, isNull } from "drizzle-orm";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import {
  type BundleTransaction,
  bundleTransaction,
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
          isNull(bundleTransaction.deletedAt),
        ),
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
          isNull(bundleTransaction.deletedAt),
        ),
      );
  }

  /**
   * Finds a record by composite primary key.
   */
  async findByCompositeId(bundleId: string, transactionId: string) {
    const [result] = await this.db
      .select()
      .from(bundleTransaction)
      .where(
        and(
          eq(bundleTransaction.bundleId, bundleId),
          eq(bundleTransaction.transactionId, transactionId),
          isNull(bundleTransaction.deletedAt),
        ),
      )
      .limit(1);
    return result;
  }

  /**
   * Soft deletes a record by composite primary key.
   */
  async deleteByCompositeId(
    bundleId: string,
    transactionId: string,
  ): Promise<void> {
    await this.db
      .update(bundleTransaction)
      .set({
        deletedAt: new Date(),
      } as any)
      .where(
        and(
          eq(bundleTransaction.bundleId, bundleId),
          eq(bundleTransaction.transactionId, transactionId),
        ),
      );
  }
}
