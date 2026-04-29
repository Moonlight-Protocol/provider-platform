import { avg, count, desc, gte, lt } from "drizzle-orm";
import type { DrizzleClient } from "@/persistence/drizzle/config.ts";
import {
  type MempoolMetric,
  mempoolMetric,
  type NewMempoolMetric,
} from "@/persistence/drizzle/entity/mempool-metric.entity.ts";

export class MempoolMetricRepository {
  constructor(private db: DrizzleClient) {}

  async insert(data: NewMempoolMetric): Promise<MempoolMetric> {
    const [row] = await this.db
      .insert(mempoolMetric)
      .values(data)
      .returning();
    return row;
  }

  /**
   * Returns the most recent N metric snapshots, newest first.
   */
  async findRecent(limit = 60): Promise<MempoolMetric[]> {
    return await this.db
      .select()
      .from(mempoolMetric)
      .orderBy(desc(mempoolMetric.recordedAt))
      .limit(limit);
  }

  /**
   * Returns aggregated averages since a given time.
   */
  async getAveragesSince(since: Date): Promise<{
    avgQueueDepth: number;
    avgSlotCount: number;
    avgProcessingMs: number;
    avgThroughputPerMin: number;
    sampleCount: number;
  }> {
    const [result] = await this.db
      .select({
        avgQueueDepth: avg(mempoolMetric.queueDepth),
        avgSlotCount: avg(mempoolMetric.slotCount),
        avgProcessingMs: avg(mempoolMetric.avgProcessingMs),
        avgThroughputPerMin: avg(mempoolMetric.throughputPerMin),
        sampleCount: count(),
      })
      .from(mempoolMetric)
      .where(gte(mempoolMetric.recordedAt, since));

    return {
      avgQueueDepth: Number(result?.avgQueueDepth ?? 0),
      avgSlotCount: Number(result?.avgSlotCount ?? 0),
      avgProcessingMs: Number(result?.avgProcessingMs ?? 0),
      avgThroughputPerMin: Number(result?.avgThroughputPerMin ?? 0),
      sampleCount: result?.sampleCount ?? 0,
    };
  }

  /**
   * Deletes metrics older than the given date. Returns the number of rows deleted.
   */
  async deleteOlderThan(before: Date): Promise<number> {
    const rows = await this.db
      .delete(mempoolMetric)
      .where(lt(mempoolMetric.recordedAt, before))
      .returning({ id: mempoolMetric.id });
    return rows.length;
  }
}
