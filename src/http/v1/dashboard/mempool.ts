import { type Context, Status } from "@oak/oak";
import { getMempool } from "@/core/mempool/index.ts";
import {
  MEMPOOL_SLOT_CAPACITY,
  MEMPOOL_EXPENSIVE_OP_WEIGHT,
  MEMPOOL_CHEAP_OP_WEIGHT,
  MEMPOOL_EXECUTOR_INTERVAL_MS,
  MEMPOOL_VERIFIER_INTERVAL_MS,
  MEMPOOL_TTL_CHECK_INTERVAL_MS,
} from "@/config/env.ts";

/**
 * GET /dashboard/mempool
 *
 * Returns mempool state (depth, slot utilization) and configuration.
 */
export const getMempoolHandler = (ctx: Context) => {
  const mempool = getMempool();
  const stats = mempool.getStats();

  ctx.response.status = Status.OK;
  ctx.response.body = {
    message: "Mempool state retrieved",
    data: {
      stats,
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
