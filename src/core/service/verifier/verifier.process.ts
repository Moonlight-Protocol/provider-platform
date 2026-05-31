import type { Logger } from "@/utils/logger/index.ts";
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
  deps: { log: Logger },
): Promise<string | null> {
  const log = deps.log.scope("findFirstBundleChannel");
  log.info("findFirstBundleChannel");
  log.debug("bundleIdCount", bundleIds.length);
  log.event("scanning bundles for channelContractId");
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
  deps: { log: Logger },
): Promise<void> {
  const log = deps.log.scope("updateTransactionStatus");
  log.info("updateTransactionStatus");
  log.debug("txId", txId);
  log.debug("status", status);
  log.event("updating transaction status in DB");
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
  log: Logger,
): Promise<void> {
  return _handleVerificationFailure(txId, reason, bundleIds, {
    operationsBundleRepository,
    updateTxStatus: (id, status) =>
      updateTransactionStatus(id, status, { log }),
    createSlotBundleFn: (bundle) => createSlotBundleFromEntity(bundle, { log }),
    reAddBundlesFn: (bundles) => getMempool().reAddBundles(bundles),
    maxRetryAttempts: VERIFIER_MAX_RETRY_ATTEMPTS,
    log,
  });
}

/**
 * Handles successful verification by updating transaction and bundles
 */
async function handleVerificationSuccess(
  txId: string,
  bundleIds: string[],
  log: Logger,
): Promise<void> {
  log.info("handleVerificationSuccess");
  log.debug("txId", txId);
  log.debug("bundleCount", bundleIds.length);
  log.event("transaction verified successfully");

  const channelContractId = await findFirstBundleChannel(bundleIds, { log });

  // Update transaction status to VERIFIED
  await updateTransactionStatus(txId, TransactionStatus.VERIFIED, { log });

  for (const bundleId of bundleIds) {
    try {
      await operationsBundleRepository.update(bundleId, {
        status: BundleStatus.COMPLETED,
        updatedAt: new Date(),
      });
    } catch (error) {
      log.debug("bundleId", bundleId);
      log.error(error, "failed to update bundle status");
    }
  }

  if (channelContractId) {
    await emitForBundles(bundleIds, (scope) => ({
      kind: "verifier.bundle_completed",
      ts: Date.now(),
      scope,
      payload: { txId, bundleIds, channelContractId },
    }), { log });
    await emitDepositAndWithdrawEvents(txId, bundleIds, channelContractId, log);
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
  log: Logger,
): Promise<void> {
  log.info("emitDepositAndWithdrawEvents");
  log.debug("txId", txId);
  log.debug("bundleCount", bundleIds.length);
  for (const bundleId of bundleIds) {
    const bundle = await operationsBundleRepository.findById(bundleId);
    if (!bundle) continue;
    for (const mlxdr of bundle.operationsMLXDR) {
      let op;
      try {
        op = MoonlightOperation.fromMLXDR(mlxdr);
      } catch (error) {
        log.debug("bundleId", bundleId);
        log.error(error, "failed to parse operation MLXDR for event emit");
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
        }), { log });
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
        }), { log });
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
  private log: Logger;

  constructor(deps: { log: Logger }) {
    this.log = deps.log.scope("Verifier");
  }

  /**
   * Starts the verifier loop
   */
  start(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.log.event("Verifier started");

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
    this.log.event("Verifier stopped");
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
        this.log.event(
          `Verifying ${unverifiedTransactions.length} transactions`,
        );

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
        this.log.error(
          new Error(String("Error during transaction verification")),
          "Error during transaction verification",
        );
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
          this.log.event(`No bundles found for transaction ${txId}`);
          return;
        }

        span.addEvent("verifying_on_network");
        const result = await verifyTransactionOnNetwork(
          txId,
          NETWORK_RPC_SERVER,
          { log: this.log },
        );

        span.addEvent("verification_result", {
          "result.status": result.status,
        });

        if (result.status === "VERIFIED") {
          await handleVerificationSuccess(txId, bundleIds, this.log);
        } else if (result.status === "FAILED") {
          const channelContractId = await findFirstBundleChannel(bundleIds, {
            log: this.log,
          });
          await handleVerificationFailure(
            txId,
            result.reason,
            bundleIds,
            this.log,
          );
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
            }), { log: this.log });
          }
        } else {
          this.log.event(`Transaction ${txId} still pending verification`);
        }
      } catch (error) {
        span.addEvent("verification_failed", {
          "error.message": error instanceof Error
            ? error.message
            : String(error),
        });
        this.log.error(
          new Error(String(`Failed to verify transaction ${txId}`)),
          `Failed to verify transaction ${txId}`,
        );
      }
    });
  }
}
