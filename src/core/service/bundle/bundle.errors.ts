import { PlatformError } from "@/error/index.ts";

export enum BUNDLE_ERROR_CODES {
  INVALID_SESSION = "BND_001",
  BUNDLE_ALREADY_EXISTS = "BND_002",
  INVALID_OPERATIONS = "BND_003",
  INSUFFICIENT_UTXOS = "BND_004",
  UTXO_NOT_FOUND = "BND_005",
  SPEND_OPERATION_NOT_SIGNED = "BND_006",
  NO_OPERATIONS_PROVIDED = "BND_007",
}

const source = "@service/bundle";

/**
 * Error thrown when session is invalid or not found
 */
export class INVALID_SESSION extends PlatformError<{ sessionId: string }> {
  constructor(sessionId: string) {
    super({
      source,
      code: BUNDLE_ERROR_CODES.INVALID_SESSION,
      message: "Invalid session",
      details: `The session with ID '${sessionId}' was not found or is invalid.`,
      api: {
        status: 401,
        message: "Invalid session",
        details: "The provided session is invalid or has expired. Please authenticate again.",
      },
      meta: {
        sessionId,
      },
    });
  }
}

/**
 * Error thrown when a bundle with the same ID already exists in pending or completed status
 */
export class BUNDLE_ALREADY_EXISTS extends PlatformError<{ bundleId: string }> {
  constructor(bundleId: string) {
    super({
      source,
      code: BUNDLE_ERROR_CODES.BUNDLE_ALREADY_EXISTS,
      message: "Bundle already exists",
      details: `A bundle with ID '${bundleId}' already exists in PENDING or COMPLETED status.`,
      api: {
        status: 409,
        message: "Bundle already exists",
        details: `An operations bundle with the same ID is already being processed or has already been completed. Please wait for it to complete or use a different set of operations.`,
      },
      meta: {
        bundleId,
      },
    });
  }
}

/**
 * Error thrown when no operations are provided in the bundle
 */
export class NO_OPERATIONS_PROVIDED extends PlatformError {
  constructor() {
    super({
      source,
      code: BUNDLE_ERROR_CODES.NO_OPERATIONS_PROVIDED,
      message: "No operations provided",
      details: "The operations bundle must contain at least one operation.",
      api: {
        status: 400,
        message: "No operations provided",
        details: "The request must include at least one operation in the operations bundle.",
      },
    });
  }
}

/**
 * Error thrown when a spend operation is not signed by the UTXO owner
 */
export class SPEND_OPERATION_NOT_SIGNED extends PlatformError<{ operationIndex?: number }> {
  constructor(operationIndex?: number) {
    super({
      source,
      code: BUNDLE_ERROR_CODES.SPEND_OPERATION_NOT_SIGNED,
      message: "Spend operation not signed",
      details: "A spend operation must be signed by the UTXO owner.",
      api: {
        status: 400,
        message: "Spend operation not signed",
        details: "All spend operations must be signed by the UTXO owner. Please ensure the operation includes the required signature.",
      },
      meta: operationIndex !== undefined ? { operationIndex } : undefined,
    });
  }
}

/**
 * Error thrown when a UTXO referenced in a spend operation is not found
 */
export class UTXO_NOT_FOUND extends PlatformError<{ utxoId: string }> {
  constructor(utxoId: string) {
    super({
      source,
      code: BUNDLE_ERROR_CODES.UTXO_NOT_FOUND,
      message: "UTXO not found",
      details: `The UTXO with ID '${utxoId}' was not found in the system.`,
      api: {
        status: 404,
        message: "UTXO not found",
        details: `The UTXO referenced in the spend operation does not exist or has already been spent. UTXO ID: ${utxoId}`,
      },
      meta: {
        utxoId,
      },
    });
  }
}

/**
 * Error thrown when there are not enough UTXOs available for the operation
 */
export class INSUFFICIENT_UTXOS extends PlatformError<{ required: number; available?: number }> {
  constructor(required: number, available?: number) {
    super({
      source,
      code: BUNDLE_ERROR_CODES.INSUFFICIENT_UTXOS,
      message: "Insufficient UTXOs",
      details: `Not enough free UTXOs available. Required: ${required}${available !== undefined ? `, Available: ${available}` : ""}.`,
      api: {
        status: 400,
        message: "Insufficient UTXOs",
        details: "The system does not have enough available UTXOs to process this bundle. Please try again later.",
      },
      meta: {
        required,
        ...(available !== undefined && { available }),
      },
    });
  }
}

/**
 * Generic error for invalid operations (used for cases not covered by specific errors)
 */
export class INVALID_OPERATIONS extends PlatformError<{ reason: string }> {
  constructor(reason: string, details?: string) {
    super({
      source,
      code: BUNDLE_ERROR_CODES.INVALID_OPERATIONS,
      message: "Invalid operations",
      details: details || `The provided operations are invalid: ${reason}`,
      api: {
        status: 400,
        message: "Invalid operations",
        details: `The operations bundle contains invalid operations: ${reason}`,
      },
      meta: {
        reason,
      },
    });
  }
}
