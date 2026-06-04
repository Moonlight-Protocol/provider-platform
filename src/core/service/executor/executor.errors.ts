import { PlatformError } from "@/error/index.ts";

export enum EXECUTOR_ERROR_CODES {
  TRANSACTION_BUILD_FAILED = "EXC_001",
  TRANSACTION_SUBMIT_FAILED = "EXC_002",
  INSUFFICIENT_UTXOS = "EXC_003",
  SLOT_EMPTY = "EXC_004",
  INSUFFICIENT_FEES = "EXC_005",
}

/**
 * Structured detail attached to InsufficientFees and persisted on the bundle
 * record as `failure_detail`. All XLM amounts are stroop strings (int64).
 */
export type InsufficientFeesDetail = {
  feePayerPubkey: string;
  availableXlm: string;
  requiredXlm: string;
  shortfallXlm: string;
};

const source = "@service/executor";

/**
 * Error thrown when transaction building fails
 */
export class TRANSACTION_BUILD_FAILED
  extends PlatformError<{ reason: string }> {
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
export class TRANSACTION_SUBMIT_FAILED
  extends PlatformError<{ reason: string; transactionHash?: string }> {
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
export class INSUFFICIENT_UTXOS
  extends PlatformError<{ required: number; available: number }> {
  constructor(required: number, available: number) {
    super({
      source,
      code: EXECUTOR_ERROR_CODES.INSUFFICIENT_UTXOS,
      message: "Insufficient UTXOs",
      details:
        `Not enough free UTXOs available. Required: ${required}, Available: ${available}`,
      meta: { required, available },
    });
  }
}

/**
 * Pre-flight terminal failure: the fee-paying account cannot cover the
 * simulated tx fee after subtracting Stellar minimum reserves. Thrown by the
 * pre-flight check before any signing or submission attempt. The submit
 * orchestration catches this specifically and moves the bundle straight to
 * BundleStatus.FAILED (no retry counter, no mempool retention).
 */
export class InsufficientFees extends PlatformError<InsufficientFeesDetail> {
  readonly detail: InsufficientFeesDetail;

  constructor(detail: InsufficientFeesDetail) {
    super({
      source,
      code: EXECUTOR_ERROR_CODES.INSUFFICIENT_FEES,
      message: "Insufficient fees on fee-payer account",
      details:
        `Fee payer ${detail.feePayerPubkey} has ${detail.availableXlm} stroops available after reserves; required ${detail.requiredXlm} (shortfall ${detail.shortfallXlm}).`,
      meta: detail,
    });
    this.detail = detail;
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
