import { LOG } from "@/config/logger.ts";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { TransactionStatus } from "@/persistence/drizzle/entity/transaction.entity.ts";
import {
  MEMPOOL_MAX_RETRY_ATTEMPTS,
  MEMPOOL_VERIFIER_INTERVAL_MS,
  NETWORK_RPC_SERVER,
} from "@/config/env.ts";
import { verifyTransactionOnNetwork } from "@/core/service/verifier/verifier.service.ts";
import {
  BundleTransactionRepository,
  OperationsBundleRepository,
  TransactionRepository,
} from "@/persistence/drizzle/repository/index.ts";
import { BundleStatus } from "@/persistence/drizzle/entity/operations-bundle.entity.ts";
import { getMempool } from "@/core/mempool/index.ts";
import { createSlotBundleFromEntity } from "@/core/service/mempool/mempool.process.ts";
import { withSpan } from "@/core/tracing.ts";
import {
  handleVerificationFailure as _handleVerificationFailure,
} from "@/core/service/verifier/verifier-failure.helpers.ts";
import { emitForBundles } from "@/core/service/events/emit-helpers.ts";
import { MoonlightOperation } from "@moonlight/moonlight-sdk";

async function findFirstBundleChannel(
  bundleIds: string[],
): Promise<string | null> {
  for (const bundleId of bundleIds) {
    const bundle = await operationsBundleRepository.findById(bundleId);
    if (bundle?.channelContractId) return bundle.channelContractId;
  }
  return null;
}

const VERIFIER_CONFIG = {
  INTERVAL_MS: MEMPOOL_VERIFIER_INTERVAL_MS,
} as const;

const transactionRepository = new TransactionRepository();
const bundleTransactionRepository = new BundleTransactionRepository();
const operationsBundleRepository = new OperationsBundleRepository(
  drizzleClient,
);

/**
 * Updates transaction status in database
 */
async function updateTransactionStatus(
  txId: string,
  status: TransactionStatus,
): Promise<void> {
  await transactionRepository.update(txId, {
    status,
    updatedAt: new Date(),
  });
}

const VERIFIER_MAX_RETRY_ATTEMPTS = MEMPOOL_MAX_RETRY_ATTEMPTS;

/**
 * Handles verification failure.
 * Delegates to the injectable helper so the logic can be unit-tested
 * independently of module-level singletons.
 */
function handleVerificationFailure(
  txId: string,
  reason: string,
  bundleIds: string[],
): Promise<void> {
  return _handleVerificationFailure(txId, reason, bundleIds, {
    operationsBundleRepository,
    updateTxStatus: (id, status) => updateTransactionStatus(id, status),
    createSlotBundleFn: createSlotBundleFromEntity,
    reAddBundlesFn: (bundles) => getMempool().reAddBundles(bundles),
    maxRetryAttempts: VERIFIER_MAX_RETRY_ATTEMPTS,
  });
}

/**
 * Handles successful verification by updating transaction and bundles
 */
async function handleVerificationSuccess(
  txId: string,
  bundleIds: string[],
): Promise<void> {
  LOG.info("Transaction verified successfully", {
    txId,
    bundleCount: bundleIds.length,
  });

  const channelContractId = await findFirstBundleChannel(bundleIds);

  // Update transaction status to VERIFIED
  await updateTransactionStatus(txId, TransactionStatus.VERIFIED);

  for (const bundleId of bundleIds) {
    try {
      await operationsBundleRepository.update(bundleId, {
        status: BundleStatus.COMPLETED,
        updatedAt: new Date(),
      });
    } catch (error) {
      LOG.error(`Failed to update bundle ${bundleId} status`, { error });
    }
  }

  if (channelContractId) {
    await emitForBundles(bundleIds, (scope) => ({
      kind: "verifier.bundle_completed",
      ts: Date.now(),
      scope,
      payload: { txId, bundleIds, channelContractId },
    }));
    await emitDepositAndWithdrawEvents(txId, bundleIds, channelContractId);
  }
}

/**
 * For each verified bundle, parse its stored operations and emit one
 * bundle.deposit_completed / bundle.withdraw_completed event per matching
 * operation so subscribers see the depositor / recipient address.
 */
async function emitDepositAndWithdrawEvents(
  txId: string,
  bundleIds: string[],
  channelContractId: string,
): Promise<void> {
  for (const bundleId of bundleIds) {
    const bundle = await operationsBundleRepository.findById(bundleId);
    if (!bundle) continue;
    for (const mlxdr of bundle.operationsMLXDR) {
      let op;
      try {
        op = MoonlightOperation.fromMLXDR(mlxdr);
      } catch (error) {
        LOG.error("Failed to parse operation MLXDR for event emit", {
          bundleId,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      if (op.isDeposit()) {
        const depositorAddress = op.getPublicKey().toString();
        const amount = op.getAmount().toString();
        await emitForBundles([bundleId], (scope) => ({
          kind: "bundle.deposit_completed",
          ts: Date.now(),
          scope,
          payload: {
            bundleId,
            txId,
            channelContractId,
            depositorAddress,
            amount,
          },
        }));
      } else if (op.isWithdraw()) {
        const recipientAddress = op.getPublicKey().toString();
        const amount = op.getAmount().toString();
        await emitForBundles([bundleId], (scope) => ({
          kind: "bundle.withdraw_completed",
          ts: Date.now(),
          scope,
          payload: {
            bundleId,
            txId,
            channelContractId,
            recipientAddress,
            amount,
          },
        }));
      }
    }
  }
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
  verifyTransactions(): Promise<void> {
    return withSpan("Verifier.verifyTransactions", async (span) => {
      try {
        const unverifiedTransactions = await transactionRepository.findByStatus(
          TransactionStatus.UNVERIFIED,
        );

        if (unverifiedTransactions.length === 0) {
          span.addEvent("no_transactions_to_verify");
          return;
        }

        span.addEvent("verifying_transactions", {
          "transactions.count": unverifiedTransactions.length,
        });
        LOG.debug(`Verifying ${unverifiedTransactions.length} transactions`);

        for (const transaction of unverifiedTransactions) {
          await this.verifyTransaction(transaction.id);
        }

        span.addEvent("verification_cycle_complete");
      } catch (error) {
        span.addEvent("verification_error", {
          "error.message": error instanceof Error
            ? error.message
            : String(error),
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
  private verifyTransaction(txId: string): Promise<void> {
    return withSpan("Verifier.verifyTransaction", async (span) => {
      try {
        span.setAttribute("tx.id", txId);

        span.addEvent("looking_up_bundle_transactions");
        const bundleTransactions = await bundleTransactionRepository
          .findByTransactionId(txId);
        const bundleIds = bundleTransactions.map((bt) => bt.bundleId);

        if (bundleIds.length === 0) {
          span.addEvent("no_bundles_found");
          LOG.warn(`No bundles found for transaction ${txId}`);
          return;
        }

        span.addEvent("verifying_on_network", {
          "bundles.count": bundleIds.length,
        });
        const result = await verifyTransactionOnNetwork(
          txId,
          NETWORK_RPC_SERVER,
        );

        span.addEvent("verification_result", {
          "result.status": result.status,
        });

        if (result.status === "VERIFIED") {
          await handleVerificationSuccess(txId, bundleIds);
        } else if (result.status === "FAILED") {
          const channelContractId = await findFirstBundleChannel(bundleIds);
          await handleVerificationFailure(txId, result.reason, bundleIds);
          if (channelContractId) {
            await emitForBundles(bundleIds, (scope) => ({
              kind: "verifier.bundle_failed",
              ts: Date.now(),
              scope,
              payload: {
                txId,
                bundleIds,
                channelContractId,
                reason: result.reason,
              },
            }));
          }
        } else {
          LOG.debug(`Transaction ${txId} still pending verification`);
        }
      } catch (error) {
        span.addEvent("verification_failed", {
          "error.message": error instanceof Error
            ? error.message
            : String(error),
        });
        LOG.error(`Failed to verify transaction ${txId}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }
}
