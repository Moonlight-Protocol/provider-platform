import { PlatformError } from "@/error/index.ts";

export enum MEMPOOL_ERROR_CODES {
  BUNDLE_NOT_FOUND = "MPL_001",
  SLOT_FULL = "MPL_002",
}

const source = "@service/mempool";

/**
 * Error thrown when a bundle is not found in the mempool
 */
export class BUNDLE_NOT_FOUND extends PlatformError<{ bundleId: string }> {
  constructor(bundleId: string) {
    super({
      source,
      code: MEMPOOL_ERROR_CODES.BUNDLE_NOT_FOUND,
      message: "Bundle not found in mempool",
      details: `The bundle with ID '${bundleId}' was not found in the mempool.`,
      meta: { bundleId },
    });
  }
}

/**
 * Error thrown when a slot is full and cannot accommodate more bundles
 */
export class SLOT_FULL extends PlatformError<{ slotWeight: number; capacity: number }> {
  constructor(slotWeight: number, capacity: number) {
    super({
      source,
      code: MEMPOOL_ERROR_CODES.SLOT_FULL,
      message: "Slot is full",
      details: `The slot cannot accommodate more bundles. Current weight: ${slotWeight}, Capacity: ${capacity}`,
      meta: { slotWeight, capacity },
    });
  }
}

