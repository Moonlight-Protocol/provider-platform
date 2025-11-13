import { eq, and, isNull } from "drizzle-orm";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import {
  operationsBundle,
  type OperationsBundle,
  type NewOperationsBundle,
} from "@/persistence/drizzle/entity/operations-bundle.entity.ts";
import { BaseRepository } from "@/persistence/drizzle/repository/base.repository.ts";

export class OperationsBundleRepository extends BaseRepository<
  typeof operationsBundle,
  OperationsBundle,
  NewOperationsBundle
> {
  constructor() {
    super(drizzleClient, operationsBundle);
  }

  /**
   * Finds bundles by status
   */
  async findByStatus(status: "PENDING" | "COMPLETED" | "EXPIRED") {
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
}

