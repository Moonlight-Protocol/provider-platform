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
  await txBuilder.signWithProvider(PROVIDER_SIGNER, expiration);

  try {
    const authEntries = txBuilder.getSignedAuthEntries();

    const { hash } = await CHANNEL_CLIENT.invokeRaw({
      operationArgs: {
        function: ChannelInvokeMethods.transact,
        args: [txBuilder.buildXDR()],
        auth: [...authEntries],
      },
      config: TX_CONFIG,
    });
    
    return hash.toString();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
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
  const errorMessage = error.message || "Unknown error";
  LOG.error("Execution failed", { error: errorMessage, bundleIds });

  // Update bundles back to PENDING status for retry
  for (const bundleId of bundleIds) {
    try {
      await operationsBundleRepository.update(bundleId, {
        status: BundleStatus.PENDING,
        updatedAt: new Date(),
      });
    } catch (updateError) {
      LOG.error(`Failed to update bundle ${bundleId} status`, { error: updateError });
    }
  }
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
    // Check if already processing a slot
    if (this.isProcessing) {
      LOG.debug("Executor already processing a slot, skipping");
      return;
    }

    const mempool = getMempool();
    let slot: ReturnType<typeof mempool.removeFirstSlot> = null;
    let bundleIds: string[] = [];

    try {
      // Set processing lock
      this.isProcessing = true;

      // Remove slot from mempool BEFORE processing to prevent concurrent execution
      slot = mempool.removeFirstSlot();

      if (!slot || slot.isEmpty()) {
        // No slots to process
        return;
      }

      // Get bundle IDs before processing
      bundleIds = slot.getBundles().map((b) => b.bundleId);

      LOG.debug("Executing slot", { 
        bundleCount: slot.getBundleCount(),
        weight: slot.getTotalWeight(),
        bundleIds 
      });

      // Build transaction from slot
      const { txBuilder, bundleIds: buildBundleIds } = await buildTransactionFromSlot(slot);
      
      // Use bundleIds from build result to ensure consistency
      bundleIds = buildBundleIds;

      // Get transaction expiration
      const expiration = await getTransactionExpiration();

      LOG.info("Transaction", { txBuilder: txBuilder.buildXDR().toXDR() });

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

      // Handle failure: re-add bundles to mempool and update status
      if (slot && !slot.isEmpty() && bundleIds.length > 0) {
        // Re-add bundles to mempool for retry
        const bundles = slot.getBundles();
        await mempool.reAddBundles(bundles);

        // Update bundle statuses to PENDING
        await handleExecutionFailure(
          error instanceof Error ? error : new Error(errorMessage),
          bundleIds
        );

        LOG.info("Bundles re-added to mempool for retry", { bundleIds });
      } else {
        LOG.error("Execution error with no slot or bundles to re-add", { 
          error: errorMessage,
          hasSlot: !!slot,
          bundleCount: bundleIds.length
        });
      }
    } finally {
      // Always release processing lock
      this.isProcessing = false;
    }
  }
}
