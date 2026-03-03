import { PlatformError } from "@/error/index.ts";

export enum VERIFIER_ERROR_CODES {
  TRANSACTION_NOT_FOUND = "VRF_001",
  VERIFICATION_FAILED = "VRF_002",
}

const source = "@service/verifier";

/**
 * Error thrown when a transaction is not found on the network
 */
export class TRANSACTION_NOT_FOUND extends PlatformError<{ transactionId: string }> {
  constructor(transactionId: string) {
    super({
      source,
      code: VERIFIER_ERROR_CODES.TRANSACTION_NOT_FOUND,
      message: "Transaction not found on network",
      details: `The transaction with ID '${transactionId}' was not found on the Stellar network.`,
      meta: { transactionId },
    });
  }
}

/**
 * Error thrown when transaction verification fails
 */
export class VERIFICATION_FAILED extends PlatformError<{ transactionId: string; reason: string }> {
  constructor(transactionId: string, reason: string) {
    super({
      source,
      code: VERIFIER_ERROR_CODES.VERIFICATION_FAILED,
      message: "Transaction verification failed",
      details: `Failed to verify transaction '${transactionId}': ${reason}`,
      meta: { transactionId, reason },
    });
  }
}
