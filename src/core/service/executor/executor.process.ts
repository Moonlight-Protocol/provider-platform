import { LOG } from "@/config/logger.ts";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { TransactionStatus } from "@/persistence/drizzle/entity/transaction.entity.ts";
import { getMempool } from "@/core/mempool/index.ts";
import { MEMPOOL_EXECUTOR_INTERVAL_MS, MEMPOOL_MAX_RETRY_ATTEMPTS, NETWORK_RPC_SERVER } from "@/config/env.ts";
import { resolveChannelContext } from "@/core/service/executor/channel-resolver.ts";
import { ChannelInvokeMethods } from "@moonlight/moonlight-sdk";
import type { SIM_ERRORS } from "@colibri/core";
import { buildTransactionFromSlot } from "@/core/service/executor/executor.service.ts";
import type { MoonlightTransactionBuilder } from "@moonlight/moonlight-sdk";
import {
  OperationsBundleRepository,
  TransactionRepository,
  BundleTransactionRepository,
} from "@/persistence/drizzle/repository/index.ts";
import { safeJsonStringify } from "@/utils/parse/safeStringify.ts";
import { withSpan } from "@/core/tracing.ts";
import {
  handleExecutionFailure as _handleExecutionFailure,
  buildRetryBundles,
} from "@/core/service/executor/executor-failure.helpers.ts";

const EXECUTOR_CONFIG = {
  INTERVAL_MS: MEMPOOL_EXECUTOR_INTERVAL_MS,
  TRANSACTION_EXPIRATION_OFFSET: 1000,
  MAX_RETRY_ATTEMPTS: MEMPOOL_MAX_RETRY_ATTEMPTS,
} as const;

const operationsBundleRepository = new OperationsBundleRepository(drizzleClient);
const transactionRepository = new TransactionRepository();
const bundleTransactionRepository = new BundleTransactionRepository();

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}…(truncated)`;
}

/**
 * Gets transaction expiration from latest ledger
 */
async function getTransactionExpiration(): Promise<number> {
  const latestLedger = await NETWORK_RPC_SERVER.getLatestLedger();
  return latestLedger.sequence + EXECUTOR_CONFIG.TRANSACTION_EXPIRATION_OFFSET;
}

type SimulationFailureContext = {
  simulationResponse?: string;
  failedTxXdr?: string;
};

type ExecutionFailureContext = {
  phase: string;
  simulation?: SimulationFailureContext;
};

class ExecutionError extends Error {
  readonly failureContext: ExecutionFailureContext;

  constructor(cause: Error, failureContext: ExecutionFailureContext) {
    super(cause.message);
    this.name = "ExecutionError";
    this.stack = cause.stack;
    this.failureContext = failureContext;
  }
}

/**
 * Submits transaction to channel contract using the resolved PP context.
 */
function submitTransactionToNetwork(
  txBuilder: MoonlightTransactionBuilder,
  expiration: number,
  channelContractId: string,
): Promise<string> {
  return withSpan("Executor.submitTransactionToNetwork", async (span) => {
    const { signer, channelClient, txConfig } = await resolveChannelContext(channelContractId);

    span.addEvent("signing_with_provider");
    await txBuilder.signWithProvider(signer, expiration);

    try {
      const authEntries = txBuilder.getSignedAuthEntries();

      span.addEvent("invoking_channel_contract");
      const { hash } = await channelClient.invokeRaw({
        operationArgs: {
          function: ChannelInvokeMethods.transact,
          args: [txBuilder.buildXDR()],
          auth: [...authEntries],
        },
        config: txConfig,
      });
      
      span.addEvent("transaction_submitted", { "tx.hash": hash.toString() });
      return hash.toString();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      LOG.error("Transaction submission failed", { error: errorMessage });
      span.addEvent("submission_failed", { "error.message": errorMessage });
      const baseError = error instanceof Error ? error : new Error(errorMessage);
      const failureContext: ExecutionFailureContext = {
        phase: "submitTransactionToNetwork",
      };

      const simError = error as SIM_ERRORS.SIMULATION_FAILED;
      if (simError?.meta?.data) {
        const simResponse = simError.meta.data.simulationResponse ?? simError.meta.data;
        LOG.error("Simulation details", {
          simError: JSON.stringify(simResponse, null, 2),
        });

        if (simError.meta.data.input?.transaction) {
          LOG.error("Failed transaction XDR", {
            xdr: simError.meta.data.input.transaction.toXDR(),
          });
        }

        const failedTxXdr = simError.meta.data.input?.transaction
          ? truncate(simError.meta.data.input.transaction.toXDR(), 2000)
          : undefined;

        const simulationResponseJson = safeJsonStringify(simResponse);

        failureContext.simulation = {
          simulationResponse: simulationResponseJson
            ? truncate(simulationResponseJson, 4000)
            : undefined,
          failedTxXdr,
        };
      }

      throw new ExecutionError(baseError, failureContext);
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
 * Handles execution failure by updating bundle statuses.
 * Delegates to the injectable helper so the logic can be unit-tested
 * independently of module-level singletons.
 */
function handleExecutionFailure(
  error: Error,
  bundleIds: string[],
  lastFailureReason: string,
) {
  return _handleExecutionFailure(error, bundleIds, lastFailureReason, {
    operationsBundleRepository,
    maxRetryAttempts: EXECUTOR_CONFIG.MAX_RETRY_ATTEMPTS,
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
  executeNext(): Promise<void> {
    if (this.isProcessing) {
      return Promise.resolve();
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
          bundleIds,
        });

        // Resolve channel context from the first bundle in the slot
        const slotBundles = slot.getBundles();
        const channelContractId = slotBundles[0]?.channelContractId;
        if (!channelContractId) throw new Error("Bundle missing channelContractId");

        const channelCtx = await resolveChannelContext(channelContractId);

        // Build transaction from slot using the resolved context
        const { txBuilder, bundleIds: buildBundleIds } = await buildTransactionFromSlot(slot, channelCtx);

        // Use bundleIds from build result to ensure consistency
        bundleIds = buildBundleIds;

        // Get transaction expiration
        const expiration = await getTransactionExpiration();

        // Submit transaction to network
        const transactionHash = await submitTransactionToNetwork(txBuilder, expiration, channelContractId);

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
        const errorInstance = error instanceof Error ? error : new Error(errorMessage);

        const failureContext = error instanceof ExecutionError
          ? error.failureContext
          : undefined;

        const lastFailureReasonPayload = {
          occurredAt: new Date().toISOString(),
          phase: failureContext?.phase ?? "slotExecution",
          error: {
            name: errorInstance.name,
            message: errorInstance.message,
            stack: errorInstance.stack ? truncate(errorInstance.stack, 4000) : undefined,
          },
          slot: slot
            ? {
                bundleCount: slot.getBundleCount(),
                totalWeight: slot.getTotalWeight(),
              }
            : undefined,
          bundleIds,
          simulation: failureContext?.simulation,
        };

        const lastFailureReason = safeJsonStringify(lastFailureReasonPayload) ??
          truncate(errorMessage, 2000);

        LOG.error("Slot execution failed", { 
          error: errorMessage,
          bundleIds 
        });

        // Handle failure: re-add bundles to mempool (only those still elegible) and update status
        if (slot && !slot.isEmpty() && bundleIds.length > 0) {
          // Update bundle statuses and retry counters
          const bundlesToRetryMeta = await handleExecutionFailure(
            errorInstance,
            bundleIds,
            lastFailureReason,
          );

          // Reuse the in-memory slot bundle objects, but update retryCount/lastFailureReason
          // based on the decision computed from the database.
          const bundlesToRetry = buildRetryBundles(slot, bundlesToRetryMeta);

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
            bundleCount: bundleIds.length,
          });
        }
      } finally {
        this.isProcessing = false;
      }
    });

  }
}
