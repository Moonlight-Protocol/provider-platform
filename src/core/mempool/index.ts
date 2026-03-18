import { Mempool } from "@/core/service/mempool/mempool.process.ts";
import { Executor } from "@/core/service/executor/executor.process.ts";
import { Verifier } from "@/core/service/verifier/verifier.process.ts";
import { MetricsCollector } from "@/core/service/mempool-metrics/metrics-collector.ts";
import { MEMPOOL_SLOT_CAPACITY, MEMPOOL_TTL_CHECK_INTERVAL_MS } from "@/config/env.ts";
import { LOG } from "@/config/logger.ts";

/**
 * Singleton instance of the Mempool
 * Will be initialized during application startup
 */
export let mempool: Mempool;

/**
 * Singleton instance of the Executor
 * Will be initialized during application startup
 */
export let executor: Executor;

/**
 * Singleton instance of the Verifier
 * Will be initialized during application startup
 */
export let verifier: Verifier;

/**
 * Singleton instance of the MetricsCollector
 */
export let metricsCollector: MetricsCollector;

/**
 * Interval ID for TTL check
 */
let ttlCheckIntervalId: number | null = null;

/**
 * Initializes the mempool singleton instance
 * Should be called during application startup
 */
export function initializeMempool(): void {
  if (mempool) {
    throw new Error("Mempool already initialized");
  }
  mempool = new Mempool(MEMPOOL_SLOT_CAPACITY);
}

/**
 * Gets the mempool instance
 * Throws if not initialized
 */
export function getMempool(): Mempool {
  if (!mempool) {
    throw new Error("Mempool not initialized. Call initializeMempool() first.");
  }
  return mempool;
}

/**
 * Initializes the complete mempool system
 * - Initializes Mempool and loads pending bundles from database
 * - Starts Executor service
 * - Starts Verifier service
 * - Starts periodic TTL check
 */
export async function initializeMempoolSystem(): Promise<void> {
  LOG.info("Initializing mempool system...");

  // Initialize Mempool
  initializeMempool();
  await mempool.initialize();

  // Initialize Executor
  executor = new Executor();
  executor.start();

  // Initialize Verifier
  verifier = new Verifier();
  verifier.start();

  // Initialize MetricsCollector
  const denoJson = JSON.parse(await Deno.readTextFile("deno.json"));
  metricsCollector = new MetricsCollector(denoJson.version ?? "unknown");
  metricsCollector.start();

  // Start periodic TTL check
  ttlCheckIntervalId = setInterval(async () => {
    try {
      await mempool.expireBundles();
    } catch (error) {
      LOG.error("Error during TTL check", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, MEMPOOL_TTL_CHECK_INTERVAL_MS) as unknown as number;

  LOG.info("Mempool system initialized successfully");
}

/**
 * Shuts down the mempool system gracefully
 * Stops all services and clears intervals
 */
export function shutdownMempoolSystem(): void {
  LOG.info("Shutting down mempool system...");

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

  LOG.info("Mempool system shut down successfully");
}
