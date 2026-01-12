import { PlatformError } from "@/error/index.ts";

export enum EXECUTOR_ERROR_CODES {
  TRANSACTION_BUILD_FAILED = "EXC_001",
  TRANSACTION_SUBMIT_FAILED = "EXC_002",
  INSUFFICIENT_UTXOS = "EXC_003",
  SLOT_EMPTY = "EXC_004",
}

const source = "@service/executor";

/**
 * Error thrown when transaction building fails
 */
export class TRANSACTION_BUILD_FAILED extends PlatformError<{ reason: string }> {
  constructor(reason: string) {
    super({
      source,
      code: EXECUTOR_ERROR_CODES.TRANSACTION_BUILD_FAILED,
      message: "Transaction build failed",
      details: `Failed to build transaction from slot: ${reason}`,
      meta: { reason },
    });
  }
}

/**
 * Error thrown when transaction submission fails
 */
export class TRANSACTION_SUBMIT_FAILED extends PlatformError<{ reason: string; transactionHash?: string }> {
  constructor(reason: string, transactionHash?: string) {
    super({
      source,
      code: EXECUTOR_ERROR_CODES.TRANSACTION_SUBMIT_FAILED,
      message: "Transaction submission failed",
      details: `Failed to submit transaction to network: ${reason}`,
      meta: { reason, ...(transactionHash && { transactionHash }) },
    });
  }
}

/**
 * Error thrown when there are insufficient UTXOs for transaction
 */
export class INSUFFICIENT_UTXOS extends PlatformError<{ required: number; available: number }> {
  constructor(required: number, available: number) {
    super({
      source,
      code: EXECUTOR_ERROR_CODES.INSUFFICIENT_UTXOS,
      message: "Insufficient UTXOs",
      details: `Not enough free UTXOs available. Required: ${required}, Available: ${available}`,
      meta: { required, available },
    });
  }
}

/**
 * Error thrown when trying to execute an empty slot
 */
export class SLOT_EMPTY extends PlatformError {
  constructor() {
    super({
      source,
      code: EXECUTOR_ERROR_CODES.SLOT_EMPTY,
      message: "Slot is empty",
      details: "Cannot execute an empty slot",
    });
  }
}
