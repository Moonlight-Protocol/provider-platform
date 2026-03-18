import { type Context, Status } from "@oak/oak";
import { getMempool, platformVersion } from "@/core/mempool/index.ts";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { MempoolMetricRepository } from "@/persistence/drizzle/repository/mempool-metric.repository.ts";
import {
  MEMPOOL_SLOT_CAPACITY,
  MEMPOOL_EXPENSIVE_OP_WEIGHT,
  MEMPOOL_CHEAP_OP_WEIGHT,
  MEMPOOL_EXECUTOR_INTERVAL_MS,
  MEMPOOL_VERIFIER_INTERVAL_MS,
  MEMPOOL_TTL_CHECK_INTERVAL_MS,
} from "@/config/env.ts";

const metricRepo = new MempoolMetricRepository(drizzleClient);

/**
 * GET /dashboard/mempool
 *
 * Returns live mempool state, historical averages, and configuration.
 * Averages are computed from the last hour of metric snapshots.
 */
export const getMempoolHandler = async (ctx: Context) => {
  const mempool = getMempool();
  const stats = mempool.getStats();

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const averages = await metricRepo.getAveragesSince(oneHourAgo);

  ctx.response.status = Status.OK;
  ctx.response.body = {
    message: "Mempool state retrieved",
    data: {
      platformVersion,
      live: stats,
      averages: {
        windowMinutes: 60,
        sampleCount: averages.sampleCount,
        avgQueueDepth: round(averages.avgQueueDepth),
        avgSlotCount: round(averages.avgSlotCount),
        avgProcessingMs: round(averages.avgProcessingMs),
        avgThroughputPerMin: round(averages.avgThroughputPerMin),
      },
      config: {
        slotCapacity: MEMPOOL_SLOT_CAPACITY,
        expensiveOpWeight: MEMPOOL_EXPENSIVE_OP_WEIGHT,
        cheapOpWeight: MEMPOOL_CHEAP_OP_WEIGHT,
        executorIntervalMs: MEMPOOL_EXECUTOR_INTERVAL_MS,
        verifierIntervalMs: MEMPOOL_VERIFIER_INTERVAL_MS,
        ttlCheckIntervalMs: MEMPOOL_TTL_CHECK_INTERVAL_MS,
      },
    },
  };
};

function round(n: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}
