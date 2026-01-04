import { eq, and, isNull, asc } from "drizzle-orm";
import type { DrizzleClient } from "@/persistence/drizzle/config.ts";
import {
  mempoolQueue,
  type MempoolQueue,
  type NewMempoolQueue,
  MempoolQueueStatus,
} from "@/persistence/drizzle/entity/mempool-queue.entity.ts";
import { BaseRepository } from "@/persistence/drizzle/repository/base.repository.ts";

export class MempoolQueueRepository extends BaseRepository<
  typeof mempoolQueue,
  MempoolQueue,
  NewMempoolQueue
> {
  constructor(db: DrizzleClient) {
    super(db, mempoolQueue);
  }

  /**
   * Finds queue items by status
   */
  async findByStatus(status: MempoolQueueStatus): Promise<MempoolQueue[]> {
    return await this.db
      .select()
      .from(mempoolQueue)
      .where(
        and(
          eq(mempoolQueue.status, status),
          isNull(mempoolQueue.deletedAt)
        )
      )
      .orderBy(asc(mempoolQueue.createdAt));
  }

  /**
   * Finds the first pending item (FIFO - First In First Out)
   */
  async findFirstPending(): Promise<MempoolQueue | undefined> {
    const [result] = await this.db
      .select()
      .from(mempoolQueue)
      .where(
        and(
          eq(mempoolQueue.status, MempoolQueueStatus.PENDING),
          isNull(mempoolQueue.deletedAt)
        )
      )
      .orderBy(asc(mempoolQueue.createdAt))
      .limit(1);
    return result;
  }

  /**
   * Finds queue item by transaction ID
   */
  async findByTransactionId(transactionId: string): Promise<MempoolQueue | undefined> {
    const [result] = await this.db
      .select()
      .from(mempoolQueue)
      .where(
        and(
          eq(mempoolQueue.transactionId, transactionId),
          isNull(mempoolQueue.deletedAt)
        )
      )
      .limit(1);
    return result;
  }

  /**
   * Updates queue item status to PROCESSING
   */
  async markAsProcessing(id: string): Promise<MempoolQueue> {
    return await this.update(id, {
      status: MempoolQueueStatus.PROCESSING,
      updatedAt: new Date(),
    });
  }

  /**
   * Updates queue item status to COMPLETED with transaction ID
   */
  async markAsCompleted(id: string, transactionId: string): Promise<MempoolQueue> {
    return await this.update(id, {
      status: MempoolQueueStatus.COMPLETED,
      transactionId,
      processedAt: new Date(),
      updatedAt: new Date(),
    });
  }

  /**
   * Updates queue item status to FAILED
   */
  async markAsFailed(id: string): Promise<MempoolQueue> {
    return await this.update(id, {
      status: MempoolQueueStatus.FAILED,
      updatedAt: new Date(),
    });
  }
}

