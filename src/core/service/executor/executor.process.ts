import type { Logger } from "@/utils/logger/index.ts";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import {
  BundleStatus,
} from "@/persistence/drizzle/entity/operations-bundle.entity.ts";
import { TransactionStatus } from "@/persistence/drizzle/entity/transaction.entity.ts";
import { getMempool } from "@/core/mempool/index.ts";
import {
  BASE_RESERVE_STROOPS,
  MEMPOOL_EXECUTOR_INTERVAL_MS,
  MEMPOOL_MAX_RETRY_ATTEMPTS,
  NETWORK_CONFIG,
  NETWORK_FEE,
  NETWORK_RPC_SERVER,
  TRANSACTION_EXPIRATION_OFFSET,
} from "@/config/env.ts";
import { InsufficientFees } from "@/core/service/executor/executor.errors.ts";
import { runPreflightOpexFeeCheck } from "@/core/service/executor/preflight-opex-balance.ts";
import { resolveChannelContext } from "@/core/service/executor/channel-resolver.ts";
import { ChannelInvokeMethods } from "@moonlight/moonlight-sdk";
import type { SIM_ERRORS } from "@colibri/core";
import { buildTransactionFromSlot } from "@/core/service/executor/executor.service.ts";
import type { MoonlightTransactionBuilder } from "@moonlight/moonlight-sdk";
import {
  BundleTransactionRepository,
  OperationsBundleRepository,
  TransactionRepository,
} from "@/persistence/drizzle/repository/index.ts";
import { safeJsonStringify } from "@/utils/parse/safeStringify.ts";
import { withSpan } from "@/core/tracing.ts";
import {
  buildRetryBundles,
  handleExecutionFailure as _handleExecutionFailure,
} from "@/core/service/executor/executor-failure.helpers.ts";
import {
  extractNetworkErrorContext,
  type NetworkErrorContext,
  recordNetworkErrorOnSpan,
} from "@/core/service/executor/error-extraction.ts";
import { emitForBundles } from "@/core/service/events/emit-helpers.ts";

/** Approximate Stellar ledger close time in milliseconds. Used to convert a
 *  ledger-sequence offset into a wall-clock duration for the DB timeout.
 *  Replace with a dynamic fetch once CU-TODO is implemented. */
const STELLAR_LEDGER_CLOSE_TIME_MS = 5_000;

const EXECUTOR_CONFIG = {
  INTERVAL_MS: MEMPOOL_EXECUTOR_INTERVAL_MS,
  TRANSACTION_EXPIRATION_OFFSET,
  MAX_RETRY_ATTEMPTS: MEMPOOL_MAX_RETRY_ATTEMPTS,
} as const;

const operationsBundleRepository = new OperationsBundleRepository(
  drizzleClient,
);
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
  network?: NetworkErrorContext;
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
  ppPublicKey: string,
  log: Logger,
): Promise<string> {
  return withSpan("Executor.submitTransactionToNetwork", async (span) => {
    const { signer, channelClient, txConfig } = await resolveChannelContext(
      channelContractId,
      ppPublicKey,
      { log },
    );
    span.setAttribute("pp.publicKey", ppPublicKey);

    span.setAttribute("tx.source", txConfig.source);
    try {
      const acct = await NETWORK_RPC_SERVER.getAccount(txConfig.source);
      const preSeq = acct.sequenceNumber();
      span.setAttribute("tx.pre_build_account_seq", preSeq);
      span.addEvent("pre_build_account_seq", {
        "tx.source": txConfig.source,
        seq: preSeq,
      });
    } catch (e) {
      span.addEvent("pre_build_seq_lookup_failed", {
        "error.message": e instanceof Error ? e.message : String(e),
      });
    }

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
      try {
        const acctAfter = await NETWORK_RPC_SERVER.getAccount(txConfig.source);
        span.setAttribute(
          "tx.post_submit_account_seq",
          acctAfter.sequenceNumber(),
        );
      } catch (e) {
        span.addEvent("post_submit_seq_lookup_failed", {
          "error.message": e instanceof Error ? e.message : String(e),
        });
      }
      return hash.toString();
    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : String(error);
      log.error(error, "transaction submission failed");
      span.addEvent("submission_failed", { "error.message": errorMessage });
      const baseError = error instanceof Error
        ? error
        : new Error(errorMessage);
      const failureContext: ExecutionFailureContext = {
        phase: "submitTransactionToNetwork",
      };

      const networkCtx = extractNetworkErrorContext(error);
      if (networkCtx) {
        recordNetworkErrorOnSpan(span, networkCtx);
        failureContext.network = networkCtx;
        try {
          const acctAfter = await NETWORK_RPC_SERVER.getAccount(
            txConfig.source,
          );
          const postFailSeq = acctAfter.sequenceNumber();
          span.setAttribute("tx.post_fail_account_seq", postFailSeq);
          failureContext.network.postFailAccountSeq = postFailSeq;
        } catch (e) {
          span.addEvent("post_fail_seq_lookup_failed", {
            "error.message": e instanceof Error ? e.message : String(e),
          });
        }
        log.error(error, "network error details");
        log.debug("code", networkCtx.code);
        log.debug("source", networkCtx.source);
      }

      const simError = error as SIM_ERRORS.SIMULATION_FAILED;
      if (simError?.meta?.data) {
        const simResponse = simError.meta.data.simulationResponse ??
          simError.meta.data;
        log.error(error, "simulation details");
        log.debug("simError", JSON.stringify(simResponse, null, 2));

        if (simError.meta.data.input?.transaction) {
          log.debug("xdr", simError.meta.data.input.transaction.toXDR());
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
  deps: { log: Logger },
  accountId: string = "system",
): Promise<void> {
  const log = deps.log.scope("createTransactionRecord");
  log.info("createTransactionRecord");
  log.debug("txHash", txHash);
  log.debug("bundleCount", bundleIds.length);

  log.event("fetching latest ledger");
  const latestLedger = await NETWORK_RPC_SERVER.getLatestLedger();

  log.event("inserting transaction row");
  await transactionRepository.create({
    id: txHash,
    status: TransactionStatus.UNVERIFIED,
    timeout: new Date(
      Date.now() +
        EXECUTOR_CONFIG.TRANSACTION_EXPIRATION_OFFSET *
          STELLAR_LEDGER_CLOSE_TIME_MS,
    ),
    ledgerSequence: latestLedger.sequence.toString(),
    createdAt: new Date(),
    createdBy: accountId,
  });

  log.event("linking bundles to transaction");
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
  log: Logger,
) {
  return _handleExecutionFailure(error, bundleIds, lastFailureReason, {
    operationsBundleRepository,
    maxRetryAttempts: EXECUTOR_CONFIG.MAX_RETRY_ATTEMPTS,
    log,
  });
}

/**
 * Executor Service for processing slots from Mempool
 */
export class Executor {
  private intervalId: number | null = null;
  private isRunning: boolean = false;
  private isProcessing: boolean = false;
  private log: Logger;

  constructor(deps: { log: Logger }) {
    this.log = deps.log.scope("Executor");
  }

  /**
   * Starts the executor loop
   */
  start(): void {
    if (this.isRunning) {
      this.log.event("Executor is already running");
      return;
    }

    this.isRunning = true;
    this.log.event("Executor started");

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
    this.log.event("Executor stopped");
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

        // Resolve channel context from the first bundle in the slot. All
        // bundles in a slot must target the same (channel, PP) pair —
        // mempool slots are partitioned by channel, and each bundle carries
        // its own ppPublicKey from the URL-scoped submission.
        const slotBundles = slot.getBundles();
        const channelContractId = slotBundles[0]?.channelContractId;
        const ppPublicKey = slotBundles[0]?.ppPublicKey;
        if (!channelContractId) {
          throw new Error("Bundle missing channelContractId");
        }
        if (!ppPublicKey) {
          throw new Error("Bundle missing ppPublicKey");
        }

        const channelCtx = await resolveChannelContext(
          channelContractId,
          ppPublicKey,
          { log: this.log },
        );

        // Build transaction from slot using the resolved context
        const { txBuilder, bundleIds: buildBundleIds } =
          await buildTransactionFromSlot(slot, channelCtx, { log: this.log });

        // Use bundleIds from build result to ensure consistency
        bundleIds = buildBundleIds;

        // Get transaction expiration
        const expiration = await getTransactionExpiration();

        // Pre-flight OpEx fee check. Throws InsufficientFees if the PP root
        // account cannot cover (inclusion + Soroban resource fee) after
        // subtracting Stellar minimum reserves. The submit-orchestration
        // catch block routes InsufficientFees to a terminal-FAILED bypass
        // (no retry counter, no mempool retention).
        await runPreflightOpexFeeCheck(
          { txBuilder, feePayerPubkey: ppPublicKey },
          {
            rpcServer: NETWORK_RPC_SERVER,
            networkPassphrase: NETWORK_CONFIG.networkPassphrase as string,
            baseInclusionFeeStroops: BigInt(NETWORK_FEE),
            baseReserveStroops: BASE_RESERVE_STROOPS,
            log: this.log,
          },
        );

        // Submit transaction to network
        const transactionHash = await submitTransactionToNetwork(
          txBuilder,
          expiration,
          channelContractId,
          ppPublicKey,
          this.log,
        );

        this.log.debug("transactionHash", transactionHash);
        this.log.debug("bundleCount", bundleIds.length);
        this.log.event("transaction submitted successfully");

        // Create transaction record and link bundles
        await createTransactionRecord(transactionHash, bundleIds, {
          log: this.log,
        });

        this.log.event("Slot executed successfully");

        await emitForBundles(bundleIds, (scope) => ({
          kind: "executor.transaction_submitted",
          ts: Date.now(),
          scope,
          payload: {
            txHash: transactionHash,
            bundleIds,
            channelContractId,
          },
        }), { log: this.log });
      } catch (error) {
        // Typed-error fast-path: pre-flight detected an under-funded fee
        // payer. Terminal-fail every bundle in the slot with the structured
        // detail; DO NOT increment retry counters; DO NOT re-enqueue.
        if (error instanceof InsufficientFees) {
          span.addEvent("preflight_insufficient_fees_terminal", {
            bundleIds,
          });
          this.log.error(error, "pre-flight InsufficientFees — terminal-fail");
          for (const bundleId of bundleIds) {
            try {
              await operationsBundleRepository.update(bundleId, {
                status: BundleStatus.FAILED,
                lastFailureReason: error.message,
                failureDetail: { ...error.detail },
                updatedAt: new Date(),
              });
            } catch (updateError) {
              span.addEvent("insufficient_fees_persist_failed", {
                "bundle.id": bundleId,
              });
              this.log.error(
                updateError,
                "failed to mark bundle FAILED on InsufficientFees",
              );
            }
          }
          const failedChannelContractId = slot?.getBundles()[0]
            ?.channelContractId ?? null;
          if (failedChannelContractId) {
            await emitForBundles(bundleIds, (scope) => ({
              kind: "executor.execution_failed",
              ts: Date.now(),
              scope,
              payload: {
                bundleIds,
                channelContractId: failedChannelContractId,
                reason: error.message,
              },
            }), { log: this.log });
          }
          return;
        }

        const errorMessage = error instanceof Error
          ? error.message
          : String(error);
        const errorInstance = error instanceof Error
          ? error
          : new Error(errorMessage);

        const failureContext = error instanceof ExecutionError
          ? error.failureContext
          : undefined;

        // Fall back to extracting from the raw error if the inner catch didn't
        // wrap (e.g. failures outside submitTransactionToNetwork — build,
        // channel resolve, etc.) so Colibri envelope data is captured everywhere.
        const networkCtx = failureContext?.network ??
          extractNetworkErrorContext(error);
        if (networkCtx) {
          recordNetworkErrorOnSpan(span, networkCtx);
        }

        const lastFailureReasonPayload = {
          occurredAt: new Date().toISOString(),
          phase: failureContext?.phase ?? "slotExecution",
          error: {
            name: errorInstance.name,
            message: errorInstance.message,
            stack: errorInstance.stack
              ? truncate(errorInstance.stack, 4000)
              : undefined,
          },
          slot: slot
            ? {
              bundleCount: slot.getBundleCount(),
              totalWeight: slot.getTotalWeight(),
            }
            : undefined,
          bundleIds,
          simulation: failureContext?.simulation,
          network: networkCtx,
        };

        const lastFailureReason = safeJsonStringify(lastFailureReasonPayload) ??
          truncate(errorMessage, 2000);

        this.log.error(
          new Error(String("Slot execution failed")),
          "Slot execution failed",
        );

        const failedChannelContractId = slot?.getBundles()[0]
          ?.channelContractId ?? null;
        if (failedChannelContractId) {
          await emitForBundles(bundleIds, (scope) => ({
            kind: "executor.execution_failed",
            ts: Date.now(),
            scope,
            payload: {
              bundleIds,
              channelContractId: failedChannelContractId,
              reason: errorMessage,
            },
          }), { log: this.log });
        }

        // Handle failure: re-add bundles to mempool (only those still elegible) and update status
        if (slot && !slot.isEmpty() && bundleIds.length > 0) {
          // Update bundle statuses and retry counters
          const bundlesToRetryMeta = await handleExecutionFailure(
            errorInstance,
            bundleIds,
            lastFailureReason,
            this.log,
          );

          // Reuse the in-memory slot bundle objects, but update retryCount/lastFailureReason
          // based on the decision computed from the database.
          const bundlesToRetry = buildRetryBundles(slot, bundlesToRetryMeta, {
            log: this.log,
          });

          if (bundlesToRetry.length > 0) {
            await mempool.reAddBundles(bundlesToRetry);
            this.log.event("Bundles re-added to mempool for retry");
          }
        } else {
          this.log.error(
            new Error(
              String("Execution error with no slot or bundles to re-add"),
            ),
            "Execution error with no slot or bundles to re-add",
          );
        }
      } finally {
        this.isProcessing = false;
      }
    });
  }
}
