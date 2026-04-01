import { eq, and, or, isNull, desc, count, gte, lte, inArray, lt } from "drizzle-orm";
import type { DrizzleClient } from "@/persistence/drizzle/config.ts";
import {
  operationsBundle,
  type OperationsBundle,
  type NewOperationsBundle,
  BundleStatus,
} from "@/persistence/drizzle/entity/operations-bundle.entity.ts";
import { BaseRepository } from "@/persistence/drizzle/repository/base.repository.ts";

export class OperationsBundleRepository extends BaseRepository<
  typeof operationsBundle,
  OperationsBundle,
  NewOperationsBundle
> {
  constructor(db: DrizzleClient) {
    super(db, operationsBundle);
  }

  /**
   * Finds bundles by status
   */
  async findByStatus(status: BundleStatus) {
    return await this.db
      .select()
      .from(operationsBundle)
      .where(
        and(
          eq(operationsBundle.status, status),
          isNull(operationsBundle.deletedAt)
        )
      );
  }

  /**
   * Finds bundles with status PENDING or PROCESSING
   * Used for mempool initialization
   */
  async findPendingOrProcessing(): Promise<OperationsBundle[]> {
    return await this.db
      .select()
      .from(operationsBundle)
      .where(
        and(
          isNull(operationsBundle.deletedAt),
          or(
            eq(operationsBundle.status, BundleStatus.PENDING),
            eq(operationsBundle.status, BundleStatus.PROCESSING)
          )
        )
      );
  }

  /**
   * Counts bundles by status
   */
  async countByStatus(status: BundleStatus): Promise<number> {
    const [result] = await this.db
      .select({ count: count() })
      .from(operationsBundle)
      .where(
        and(
          eq(operationsBundle.status, status),
          isNull(operationsBundle.deletedAt)
        )
      );
    return result?.count ?? 0;
  }

  /**
   * Finds bundles by status with optional date range filter
   */
  async findByStatusAndDateRange(
    status: BundleStatus,
    from?: Date,
    to?: Date,
    limit = 10000,
  ): Promise<OperationsBundle[]> {
    const conditions = [
      eq(operationsBundle.status, status),
      isNull(operationsBundle.deletedAt),
    ];
    if (from) conditions.push(gte(operationsBundle.createdAt, from));
    if (to) conditions.push(lte(operationsBundle.createdAt, to));

    return await this.db
      .select()
      .from(operationsBundle)
      .where(and(...conditions))
      .orderBy(desc(operationsBundle.createdAt))
      .limit(limit);
  }

  /**
   * Finds bundles that transitioned to the given status within a time window.
   * Filters on updatedAt (when the status changed), not createdAt.
   */
  async findByStatusUpdatedSince(
    status: BundleStatus,
    since: Date,
    limit = 10000,
  ): Promise<OperationsBundle[]> {
    return await this.db
      .select()
      .from(operationsBundle)
      .where(
        and(
          eq(operationsBundle.status, status),
          gte(operationsBundle.updatedAt, since),
          isNull(operationsBundle.deletedAt),
        )
      )
      .orderBy(desc(operationsBundle.updatedAt))
      .limit(limit);
  }

  /**
   * Finds bundles by creator account ID, optionally filtered by status
   * Results are ordered by createdAt descending (most recent first)
   */
  /**
   * Bulk-expires bundles matching the given statuses that were created before `olderThan`.
   * Returns the number of rows updated.
   */
  async expireOlderThan(olderThan: Date, statuses: BundleStatus[]): Promise<number> {
    const result = await this.db
      .update(operationsBundle)
      .set({ status: BundleStatus.EXPIRED, updatedAt: new Date() })
      .where(
        and(
          isNull(operationsBundle.deletedAt),
          inArray(operationsBundle.status, statuses),
          lt(operationsBundle.createdAt, olderThan)
        )
      );
    return (result as unknown as { rowCount?: number }).rowCount ?? 0;
  }

  async findByCreatedBy(
    accountId: string,
    status?: BundleStatus
  ): Promise<OperationsBundle[]> {
    const conditions = [
      eq(operationsBundle.createdBy, accountId),
      isNull(operationsBundle.deletedAt),
    ];

    if (status) {
      conditions.push(eq(operationsBundle.status, status));
    }

    return await this.db
      .select()
      .from(operationsBundle)
      .where(and(...conditions))
      .orderBy(desc(operationsBundle.createdAt));
  }
}

