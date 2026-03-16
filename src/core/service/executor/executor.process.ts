import { LOG } from "@/config/logger.ts";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { BundleStatus } from "@/persistence/drizzle/entity/operations-bundle.entity.ts";
import { TransactionStatus } from "@/persistence/drizzle/entity/transaction.entity.ts";
import { getMempool } from "@/core/mempool/index.ts";
import { MEMPOOL_EXECUTOR_INTERVAL_MS } from "@/config/env.ts";
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
): Promise<void> {
  return withSpan("Executor.handleExecutionFailure", async (span) => {
    const errorMessage = error.message || "Unknown error";
    span.addEvent("handling_failure", { "error.message": errorMessage, "bundles.count": bundleIds.length });
    LOG.error("Execution failed", { error: errorMessage, bundleIds });

    // Update bundles back to PENDING status for retry
    for (const bundleId of bundleIds) {
      try {
        await operationsBundleRepository.update(bundleId, {
          status: BundleStatus.PENDING,
          updatedAt: new Date(),
        });
        span.addEvent("bundle_reset_to_pending", { "bundle.id": bundleId });
      } catch (updateError) {
        span.addEvent("bundle_reset_failed", { "bundle.id": bundleId });
        LOG.error(`Failed to update bundle ${bundleId} status`, { error: updateError });
      }
    }
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
      LOG.debug("Executor already processing a slot, skipping");
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

        span.addEvent("executing_slot", {
          "slot.bundleCount": slot.getBundleCount(),
          "slot.weight": slot.getTotalWeight(),
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
