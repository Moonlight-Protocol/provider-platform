import { Mempool } from "@/core/service/mempool/mempool.process.ts";
import { Executor } from "@/core/service/executor/executor.process.ts";
import { Verifier } from "@/core/service/verifier/verifier.process.ts";
import { MetricsCollector } from "@/core/service/mempool-metrics/metrics-collector.ts";
import {
  MEMPOOL_SLOT_CAPACITY,
  MEMPOOL_TTL_CHECK_INTERVAL_MS,
} from "@/config/env.ts";
import type { Logger } from "@/utils/logger/index.ts";

export let mempool: Mempool;
export let executor: Executor;
export let verifier: Verifier;
export let metricsCollector: MetricsCollector;
export let platformVersion = "unknown";

let ttlCheckIntervalId: number | null = null;

export function initializeMempool(deps: { log: Logger }): void {
  if (mempool) {
    throw new Error("Mempool already initialized");
  }
  mempool = new Mempool(MEMPOOL_SLOT_CAPACITY, deps);
}

export function getMempool(): Mempool {
  if (!mempool) {
    throw new Error("Mempool not initialized. Call initializeMempool() first.");
  }
  return mempool;
}

export async function initializeMempoolSystem(
  deps: { log: Logger },
): Promise<void> {
  const log = deps.log.scope("mempoolSystem");
  log.info("initializeMempoolSystem");
  log.event("initializing mempool system");

  // Initialize Mempool
  initializeMempool(deps);
  await mempool.initialize();

  // Initialize Executor
  executor = new Executor(deps);
  executor.start();

  // Initialize Verifier
  verifier = new Verifier(deps);
  verifier.start();

  // Read platform version once at startup
  try {
    const denoJsonPath =
      new URL("../../../deno.json", import.meta.url).pathname;
    const denoJson = JSON.parse(await Deno.readTextFile(denoJsonPath));
    platformVersion = denoJson.version ?? "unknown";
  } catch (err) {
    log.error(err, "could not read deno.json for platform version");
  }

  // Initialize MetricsCollector
  metricsCollector = new MetricsCollector(platformVersion, deps);
  metricsCollector.start();

  // Start periodic TTL check
  ttlCheckIntervalId = setInterval(async () => {
    try {
      await mempool.expireBundles();
    } catch (error) {
      log.error(error, "error during TTL check");
    }
  }, MEMPOOL_TTL_CHECK_INTERVAL_MS) as unknown as number;

  log.event("mempool system initialized successfully");
}

export function shutdownMempoolSystem(deps: { log: Logger }): void {
  const log = deps.log.scope("mempoolSystem");
  log.event("shutting down mempool system");

  if (executor) {
    executor.stop();
  }

  if (verifier) {
    verifier.stop();
  }

  if (metricsCollector) {
    metricsCollector.stop();
  }

  if (ttlCheckIntervalId !== null) {
    clearInterval(ttlCheckIntervalId);
    ttlCheckIntervalId = null;
  }

  log.event("mempool system shut down successfully");
}
