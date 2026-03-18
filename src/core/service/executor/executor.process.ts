import { LOG } from "@/config/logger.ts";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { BundleStatus } from "@/persistence/drizzle/entity/operations-bundle.entity.ts";
import { TransactionStatus } from "@/persistence/drizzle/entity/transaction.entity.ts";
import { getMempool } from "@/core/mempool/index.ts";
import { MEMPOOL_EXECUTOR_INTERVAL_MS, MEMPOOL_MAX_RETRY_ATTEMPTS } from "@/config/env.ts";
import { CHANNEL_CLIENT } from "@/core/channel-client/index.ts";
import { TX_CONFIG, NETWORK_RPC_SERVER, PROVIDER_SIGNER } from "@/config/env.ts";
import { ChannelInvokeMethods } from "@moonlight/moonlight-sdk";
import type { SIM_ERRORS } from "@colibri/core";
import { buildTransactionFromSlot } from "@/core/service/executor/executor.service.ts";
import type { MoonlightTransactionBuilder } from "@moonlight/moonlight-sdk";
import {
  OperationsBundleRepository,
  TransactionRepository,
  BundleTransactionRepository,
} from "@/persistence/drizzle/repository/index.ts";
import { withSpan } from "@/core/tracing.ts";

const EXECUTOR_CONFIG = {
  INTERVAL_MS: MEMPOOL_EXECUTOR_INTERVAL_MS,
  TRANSACTION_EXPIRATION_OFFSET: 1000,
  MAX_RETRY_ATTEMPTS: MEMPOOL_MAX_RETRY_ATTEMPTS,
} as const;

const operationsBundleRepository = new OperationsBundleRepository(drizzleClient);
const transactionRepository = new TransactionRepository();
const bundleTransactionRepository = new BundleTransactionRepository();

/**
 * Gets transaction expiration from latest ledger
 */
async function getTransactionExpiration(): Promise<number> {
  const latestLedger = await NETWORK_RPC_SERVER.getLatestLedger();
  return latestLedger.sequence + EXECUTOR_CONFIG.TRANSACTION_EXPIRATION_OFFSET;
}

/**
 * Submits transaction to channel contract
 */
async function submitTransactionToNetwork(
  txBuilder: MoonlightTransactionBuilder,
  expiration: number
): Promise<string> {
  return withSpan("Executor.submitTransactionToNetwork", async (span) => {
    span.addEvent("signing_with_provider");
    await txBuilder.signWithProvider(PROVIDER_SIGNER, expiration);

    try {
      const authEntries = txBuilder.getSignedAuthEntries();

      span.addEvent("invoking_channel_contract");
      const { hash } = await CHANNEL_CLIENT.invokeRaw({
        operationArgs: {
          function: ChannelInvokeMethods.transact,
          args: [txBuilder.buildXDR()],
          auth: [...authEntries],
        },
        config: TX_CONFIG,
      });

      span.addEvent("transaction_submitted", { "tx.hash": hash.toString() });
      return hash.toString();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      span.addEvent("submission_failed", { "error.message": errorMessage });
      LOG.error("Transaction submission failed", { error: errorMessage });
      const simError = error as SIM_ERRORS.SIMULATION_FAILED;
      if (simError?.meta?.data) {
        const simResponse = simError.meta.data.simulationResponse ?? simError.meta.data;
        LOG.error("Simulation details", {
          simError: JSON.stringify(simResponse, null, 2),
        });
        if (simError.meta.data.input?.transaction) {
          LOG.error("Failed transaction XDR", {
            xdr: simError.meta.data.input.transaction.toXDR()
          });
        }
      }
      throw error;
    }
  });
}

/**
 * Creates transaction record in database
 */
async function createTransactionRecord(
  txHash: string,
  bundleIds: string[],
  accountId: string = "system"
): Promise<void> {
  const latestLedger = await NETWORK_RPC_SERVER.getLatestLedger();
  
  await transactionRepository.create({
    id: txHash,
    status: TransactionStatus.UNVERIFIED,
    timeout: new Date(Date.now() + EXECUTOR_CONFIG.TRANSACTION_EXPIRATION_OFFSET * 1000),
    ledgerSequence: latestLedger.sequence.toString(),
    createdAt: new Date(),
    createdBy: accountId,
  });

  // Link bundles to transaction
  for (const bundleId of bundleIds) {
    await bundleTransactionRepository.create({
      transactionId: txHash,
      bundleId: bundleId,
      createdAt: new Date(),
      createdBy: accountId,
    });
  }
}

/**
 * Handles execution failure by updating bundle statuses
 */
async function handleExecutionFailure(
  error: Error,
  bundleIds: string[]
): Promise<Array<{ bundleId: string; nextRetryCount: number; lastFailureReason: string }>> {
  return withSpan("Executor.handleExecutionFailure", async (span) => {
    const errorMessage = error.message || "Unknown error";
    span.addEvent("handling_failure", { "error.message": errorMessage, "bundles.count": bundleIds.length });
    LOG.error("Execution failed", { error: errorMessage, bundleIds });

    const bundlesToRetry: Array<{
      bundleId: string;
      nextRetryCount: number;
      lastFailureReason: string;
    }> = [];

    for (const bundleId of bundleIds) {
      try {
        const bundle = await operationsBundleRepository.findById(bundleId);
        if (!bundle) {
          LOG.warn(`Bundle ${bundleId} not found while handling execution failure`);
          continue;
        }

        const nextRetryCount = (bundle.retryCount ?? 0) + 1;
        const hasReachedMaxAttempts = nextRetryCount >= EXECUTOR_CONFIG.MAX_RETRY_ATTEMPTS;

        if (hasReachedMaxAttempts) {
          await operationsBundleRepository.update(bundleId, {
            status: BundleStatus.FAILED,
            retryCount: nextRetryCount,
            lastFailureReason: errorMessage,
            updatedAt: new Date(),
          });
          LOG.warn("Bundle moved to dead-letter after max retry attempts reached", {
            bundleId,
            retryCount: nextRetryCount,
          });
        } else {
          await operationsBundleRepository.update(bundleId, {
            status: BundleStatus.PENDING,
            retryCount: nextRetryCount,
            lastFailureReason: errorMessage,
            updatedAt: new Date(),
          });
          span.addEvent("bundle_reset_to_pending", { "bundle.id": bundleId });

          bundlesToRetry.push({
            bundleId,
            nextRetryCount,
            lastFailureReason: errorMessage,
          });
        }
      } catch (updateError) {
        span.addEvent("bundle_reset_failed", { "bundle.id": bundleId });
        LOG.error(`Failed to update bundle ${bundleId} status`, { error: updateError });
      }
    }
    return bundlesToRetry;
  });
}

/**
 * Executor Service for processing slots from Mempool
 */
export class Executor {
  private intervalId: number | null = null;
  private isRunning: boolean = false;
  private isProcessing: boolean = false;

  /**
   * Starts the executor loop
   */
  start(): void {
    if (this.isRunning) {
      LOG.warn("Executor is already running");
      return;
    }

    this.isRunning = true;
    LOG.info("Executor started", { intervalMs: EXECUTOR_CONFIG.INTERVAL_MS });

    // Execute immediately, then on interval
    this.executeNext();

    this.intervalId = setInterval(() => {
      this.executeNext();
    }, EXECUTOR_CONFIG.INTERVAL_MS) as unknown as number;
  }

  /**
   * Stops the executor loop
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
    LOG.info("Executor stopped");
  }

  /**
   * Executes the next slot from the mempool
   */
  async executeNext(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    return withSpan("Executor.executeNext", async (span) => {
      const mempool = getMempool();
      let slot: ReturnType<typeof mempool.removeFirstSlot> = null;
      let bundleIds: string[] = [];

      try {
        this.isProcessing = true;

        slot = mempool.removeFirstSlot();

        if (!slot || slot.isEmpty()) {
          span.addEvent("no_slots_to_process");
          return;
        }

        bundleIds = slot.getBundles().map((b) => b.bundleId);

<<<<<<< HEAD
        span.addEvent("executing_slot", {
          "slot.bundleCount": slot.getBundleCount(),
          "slot.weight": slot.getTotalWeight(),
=======
      // Build transaction from slot
      const { txBuilder, bundleIds: buildBundleIds } = await buildTransactionFromSlot(slot);
      
      // Use bundleIds from build result to ensure consistency
      bundleIds = buildBundleIds;

      // Get transaction expiration
      const expiration = await getTransactionExpiration();

      // Submit transaction to network
      const transactionHash = await submitTransactionToNetwork(txBuilder, expiration);

      LOG.info("Transaction submitted successfully", { 
        transactionHash,
        bundleCount: bundleIds.length,
        bundleIds 
      });

      // Create transaction record and link bundles
      await createTransactionRecord(transactionHash, bundleIds);

      LOG.info("Slot executed successfully", { 
        transactionHash,
        bundleCount: bundleIds.length 
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      LOG.error("Slot execution failed", { 
        error: errorMessage,
        bundleIds 
      });

      // Handle failure: re-add bundles to mempool (only those still elegible) and update status
      if (slot && !slot.isEmpty() && bundleIds.length > 0) {
        // Update bundle statuses and retry counters
        const bundlesToRetryMeta = await handleExecutionFailure(
          error instanceof Error ? error : new Error(errorMessage),
          bundleIds
        );

        const metaByBundleId = new Map(
          bundlesToRetryMeta.map((m) => [m.bundleId, m] as const)
        );

        // Reuse the in-memory slot bundle objects, but update retryCount/lastFailureReason
        // based on the decision computed from the database.
        const bundlesToRetry = slot
          .getBundles()
          .filter((b) => metaByBundleId.has(b.bundleId));

        for (const bundle of bundlesToRetry) {
          const meta = metaByBundleId.get(bundle.bundleId);
          if (!meta) continue;
          bundle.retryCount = meta.nextRetryCount;
          bundle.lastFailureReason = meta.lastFailureReason;
        }

        if (bundlesToRetry.length > 0) {
          await mempool.reAddBundles(bundlesToRetry);
          LOG.info("Bundles re-added to mempool for retry", {
            bundleIds: bundlesToRetry.map((b) => b.bundleId),
          });
        }
      } else {
        LOG.error("Execution error with no slot or bundles to re-add", { 
          error: errorMessage,
          hasSlot: !!slot,
          bundleCount: bundleIds.length
>>>>>>> 16c49e0 (chore: Add retry and dead-letter to the Mempool engine)
        });

        LOG.debug("Executing slot", {
          bundleCount: slot.getBundleCount(),
          weight: slot.getTotalWeight(),
          bundleIds,
        });

        span.addEvent("building_transaction");
        const { txBuilder, bundleIds: buildBundleIds } = await buildTransactionFromSlot(slot);
        bundleIds = buildBundleIds;

        span.addEvent("getting_expiration");
        const expiration = await getTransactionExpiration();

        LOG.info("Transaction", { txBuilder: txBuilder.buildXDR().toXDR() });

        span.addEvent("submitting_to_network");
        const transactionHash = await submitTransactionToNetwork(txBuilder, expiration);

        span.addEvent("transaction_submitted", {
          "tx.hash": transactionHash,
          "bundles.count": bundleIds.length,
        });

        LOG.info("Transaction submitted successfully", {
          transactionHash,
          bundleCount: bundleIds.length,
          bundleIds,
        });

        span.addEvent("creating_transaction_record");
        await createTransactionRecord(transactionHash, bundleIds);

        span.addEvent("slot_executed_successfully");
        LOG.info("Slot executed successfully", {
          transactionHash,
          bundleCount: bundleIds.length,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        span.addEvent("execution_failed", { "error.message": errorMessage });
        LOG.error("Slot execution failed", {
          error: errorMessage,
          bundleIds,
        });

        if (slot && !slot.isEmpty() && bundleIds.length > 0) {
          span.addEvent("re_adding_bundles_to_mempool");
          const bundles = slot.getBundles();
          await mempool.reAddBundles(bundles);

          await handleExecutionFailure(
            error instanceof Error ? error : new Error(errorMessage),
            bundleIds,
          );

          LOG.info("Bundles re-added to mempool for retry", { bundleIds });
        } else {
          LOG.error("Execution error with no slot or bundles to re-add", {
            error: errorMessage,
            hasSlot: !!slot,
            bundleCount: bundleIds.length,
          });
        }
      } finally {
        this.isProcessing = false;
      }
    });
  }
}
