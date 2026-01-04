import { eq, and, isNull, asc } from "drizzle-orm";
import type { DrizzleClient } from "@/persistence/drizzle/config.ts";
import {
  mempoolSlot,
  type MempoolSlot,
  type NewMempoolSlot,
} from "@/persistence/drizzle/entity/mempool-slot.entity.ts";
import { BaseRepository } from "@/persistence/drizzle/repository/base.repository.ts";

export class MempoolSlotRepository extends BaseRepository<
  typeof mempoolSlot,
  MempoolSlot,
  NewMempoolSlot
> {
  constructor(db: DrizzleClient) {
    super(db, mempoolSlot);
  }

  /**
   * Finds all slots for a given mempool queue item
   * Ordered by slot index
   */
  async findByMempoolQueueId(mempoolQueueId: string): Promise<MempoolSlot[]> {
    return await this.db
      .select()
      .from(mempoolSlot)
      .where(
        and(
          eq(mempoolSlot.mempoolQueueId, mempoolQueueId),
          isNull(mempoolSlot.deletedAt)
        )
      )
      .orderBy(asc(mempoolSlot.slotIndex));
  }

  /**
   * Finds slot by bundle ID
   */
  async findByBundleId(bundleId: string): Promise<MempoolSlot | undefined> {
    const [result] = await this.db
      .select()
      .from(mempoolSlot)
      .where(
        and(
          eq(mempoolSlot.bundleId, bundleId),
          isNull(mempoolSlot.deletedAt)
        )
      )
      .limit(1);
    return result;
  }

  /**
   * Creates multiple slots in a single transaction
   */
  async createMany(slots: NewMempoolSlot[]): Promise<MempoolSlot[]> {
    if (slots.length === 0) {
      return [];
    }
    return await this.db
      .insert(mempoolSlot)
      .values(slots as any)
      .returning();
  }

  /**
   * Deletes all slots for a given mempool queue item
   */
  async deleteByMempoolQueueId(mempoolQueueId: string): Promise<void> {
    await this.db
      .update(mempoolSlot)
      .set({
        deletedAt: new Date(),
      } as any)
      .where(
        and(
          eq(mempoolSlot.mempoolQueueId, mempoolQueueId),
          isNull(mempoolSlot.deletedAt)
        )
      );
  }
}

