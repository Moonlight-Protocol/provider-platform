import { eq, and, isNull, desc } from "drizzle-orm";
import type { DrizzleClient } from "@/persistence/drizzle/config.ts";
import {
  operationsBundle,
  type OperationsBundle,
  type NewOperationsBundle,
  type BundleStatus,
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
  async findByStatus(status: BundleStatus.PENDING | BundleStatus.COMPLETED | BundleStatus.EXPIRED) {
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
   * Finds bundles by creator account ID, optionally filtered by status
   * Results are ordered by createdAt descending (most recent first)
   */
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

