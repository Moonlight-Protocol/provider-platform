import { LOG } from "@/config/logger.ts";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { BundleStatus } from "@/persistence/drizzle/entity/operations-bundle.entity.ts";
import { TransactionStatus } from "@/persistence/drizzle/entity/transaction.entity.ts";
import { MEMPOOL_VERIFIER_INTERVAL_MS, NETWORK_RPC_SERVER } from "@/config/env.ts";
import { verifyTransactionOnNetwork } from "@/core/service/verifier/verifier.service.ts";
import {
  TransactionRepository,
  BundleTransactionRepository,
  OperationsBundleRepository,
} from "@/persistence/drizzle/repository/index.ts";
import { withSpan } from "@/core/tracing.ts";

const VERIFIER_CONFIG = {
  INTERVAL_MS: MEMPOOL_VERIFIER_INTERVAL_MS,
} as const;

const transactionRepository = new TransactionRepository();
const bundleTransactionRepository = new BundleTransactionRepository();
const operationsBundleRepository = new OperationsBundleRepository(drizzleClient);

/**
 * Updates transaction status in database
 */
async function updateTransactionStatus(
  txId: string,
  status: TransactionStatus
): Promise<void> {
  await transactionRepository.update(txId, {
    status,
    updatedAt: new Date(),
  });
}

/**
 * Updates bundles status based on transaction verification result
 */
async function updateBundlesStatus(
  bundleIds: string[],
  status: BundleStatus
): Promise<void> {
  for (const bundleId of bundleIds) {
    try {
      await operationsBundleRepository.update(bundleId, {
        status,
        updatedAt: new Date(),
      });
    } catch (error) {
      LOG.error(`Failed to update bundle ${bundleId} status`, { error });
    }
  }
}

/**
 * Handles verification failure by updating transaction and bundles
 */
async function handleVerificationFailure(
  txId: string,
  reason: string,
  bundleIds: string[]
): Promise<void> {
  LOG.warn("Transaction verification failed", { txId, reason, bundleIds });

  // Update transaction status to FAILED
  await updateTransactionStatus(txId, TransactionStatus.FAILED);

  // Update bundles back to PENDING for potential retry
  await updateBundlesStatus(bundleIds, BundleStatus.PENDING);
}

/**
 * Handles successful verification by updating transaction and bundles
 */
async function handleVerificationSuccess(
  txId: string,
  bundleIds: string[]
): Promise<void> {
  LOG.info("Transaction verified successfully", { txId, bundleCount: bundleIds.length });

  // Update transaction status to VERIFIED
  await updateTransactionStatus(txId, TransactionStatus.VERIFIED);

  // Update bundles to COMPLETED
  await updateBundlesStatus(bundleIds, BundleStatus.COMPLETED);
}

/**
 * Verifier Service for monitoring and verifying transactions on the network
 */
export class Verifier {
  private intervalId: number | null = null;
  private isRunning: boolean = false;

  /**
   * Starts the verifier loop
   */
  start(): void {
    if (this.isRunning) {
      LOG.warn("Verifier is already running");
      return;
    }

    this.isRunning = true;
    LOG.info("Verifier started", { intervalMs: VERIFIER_CONFIG.INTERVAL_MS });

    // Verify immediately, then on interval
    this.verifyTransactions();

    this.intervalId = setInterval(() => {
      this.verifyTransactions();
    }, VERIFIER_CONFIG.INTERVAL_MS) as unknown as number;
  }

  /**
   * Stops the verifier loop
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    LOG.info("Verifier stopped");
  }

  /**
   * Verifies all unverified transactions
   */
  async verifyTransactions(): Promise<void> {
    return withSpan("Verifier.verifyTransactions", async (span) => {
      try {
        const unverifiedTransactions = await transactionRepository.findByStatus(
          TransactionStatus.UNVERIFIED
        );

        if (unverifiedTransactions.length === 0) {
          span.addEvent("no_transactions_to_verify");
          return;
        }

        span.addEvent("verifying_transactions", { "transactions.count": unverifiedTransactions.length });
        LOG.debug(`Verifying ${unverifiedTransactions.length} transactions`);

        for (const transaction of unverifiedTransactions) {
          await this.verifyTransaction(transaction.id);
        }

        span.addEvent("verification_cycle_complete");
      } catch (error) {
        span.addEvent("verification_error", {
          "error.message": error instanceof Error ? error.message : String(error),
        });
        LOG.error("Error during transaction verification", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  /**
   * Verifies a single transaction
   */
  private async verifyTransaction(txId: string): Promise<void> {
    return withSpan("Verifier.verifyTransaction", async (span) => {
      try {
        span.setAttribute("tx.id", txId);

        span.addEvent("looking_up_bundle_transactions");
        const bundleTransactions = await bundleTransactionRepository.findByTransactionId(txId);
        const bundleIds = bundleTransactions.map((bt) => bt.bundleId);

        if (bundleIds.length === 0) {
          span.addEvent("no_bundles_found");
          LOG.warn(`No bundles found for transaction ${txId}`);
          return;
        }

        span.addEvent("verifying_on_network", { "bundles.count": bundleIds.length });
        const result = await verifyTransactionOnNetwork(txId, NETWORK_RPC_SERVER);

        span.addEvent("verification_result", { "result.status": result.status });

        if (result.status === "VERIFIED") {
          await handleVerificationSuccess(txId, bundleIds);
        } else if (result.status === "FAILED") {
          await handleVerificationFailure(txId, result.reason, bundleIds);
        } else {
          LOG.debug(`Transaction ${txId} still pending verification`);
        }
      } catch (error) {
        span.addEvent("verification_failed", {
          "error.message": error instanceof Error ? error.message : String(error),
        });
        LOG.error(`Failed to verify transaction ${txId}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }
}
