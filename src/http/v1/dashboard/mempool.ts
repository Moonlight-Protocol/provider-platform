import { type Context, Status } from "@oak/oak";
import { getMempool, platformVersion } from "@/core/mempool/index.ts";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { MempoolMetricRepository } from "@/persistence/drizzle/repository/mempool-metric.repository.ts";
import {
  MEMPOOL_CHEAP_OP_WEIGHT,
  MEMPOOL_EXECUTOR_INTERVAL_MS,
  MEMPOOL_EXPENSIVE_OP_WEIGHT,
  MEMPOOL_SLOT_CAPACITY,
  MEMPOOL_TTL_CHECK_INTERVAL_MS,
  MEMPOOL_VERIFIER_INTERVAL_MS,
} from "@/config/env.ts";
import type { PaymentProvider } from "@/persistence/drizzle/entity/pp.entity.ts";
import type { Logger } from "@/utils/logger/index.ts";

const metricRepo = new MempoolMetricRepository(drizzleClient);

/**
 * GET /api/v1/providers/:ppPublicKey/mempool
 *
 * Returns live mempool state (platform-wide; the mempool is a single in-process
 * queue shared by all PPs on this instance) plus historical averages from the
 * last hour FILTERED to this PP's recorded snapshots.
 */
export function handleGetMempool(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("getMempool");

  return async (ctx) => {
    log.info("getMempool");
    const pp = ctx.state.pp as PaymentProvider;

    log.event("reading live mempool stats");
    const mempool = getMempool();
    const stats = mempool.getStats();

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    log.event("fetching per-PP historical averages");
    const averages = await metricRepo.getAveragesSinceForPp(
      pp.publicKey,
      oneHourAgo,
    );
    log.debug("sampleCount", averages.sampleCount);

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
    log.event("mempool response assembled");
  };
}

function round(n: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}
