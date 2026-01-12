import { Mempool } from "@/core/service/mempool/mempool.process.ts";
import { MEMPOOL_SLOT_CAPACITY } from "@/config/env.ts";

/**
 * Singleton instance of the Mempool
 * Will be initialized during application startup
 */
export let mempool: Mempool;

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

