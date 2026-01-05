import { PlatformError } from "@/error/index.ts";

export enum MEMPOOL_ERROR_CODES {
  INVALID_SLOT_CAPACITY = "MPL_001",
  SLOT_INDEX_OUT_OF_BOUNDS = "MPL_002",
  BUNDLE_HAS_NO_OPERATIONS = "MPL_003",
}

const source = "@service/mempool";

export class INVALID_SLOT_CAPACITY extends PlatformError<{ capacity: number }> {
  constructor(capacity: number) {
    super({
      source,
      code: MEMPOOL_ERROR_CODES.INVALID_SLOT_CAPACITY,
      message: "Invalid slot capacity",
      details: `Slot capacity must be greater than 0. Received: ${capacity}`,
      api: {
        status: 500,
        message: "Invalid slot capacity",
        details: "The mempool slot capacity configuration is invalid.",
      },
      meta: { capacity },
    });
  }
}

export class SLOT_INDEX_OUT_OF_BOUNDS extends PlatformError<{ index: number; capacity: number }> {
  constructor(index: number, capacity: number) {
    super({
      source,
      code: MEMPOOL_ERROR_CODES.SLOT_INDEX_OUT_OF_BOUNDS,
      message: "Slot index out of bounds",
      details: `Slot index ${index} is out of bounds. Valid range: 0 to ${capacity - 1}`,
      api: {
        status: 500,
        message: "Slot index out of bounds",
        details: "An internal error occurred while accessing a mempool slot.",
      },
      meta: { index, capacity },
    });
  }
}

export class BUNDLE_HAS_NO_OPERATIONS extends PlatformError<{ bundleId: string }> {
  constructor(bundleId: string) {
    super({
      source,
      code: MEMPOOL_ERROR_CODES.BUNDLE_HAS_NO_OPERATIONS,
      message: "Bundle has no operations",
      details: `Bundle ${bundleId} has no operations and cannot be processed.`,
      api: {
        status: 500,
        message: "Bundle has no operations",
        details: "An internal error occurred while processing the bundle.",
      },
      meta: { bundleId },
    });
  }
}

