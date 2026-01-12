import { MoonlightOperation, MoonlightTransactionBuilder } from "@moonlight/moonlight-sdk";
import type { Slot } from "@/core/service/mempool/mempool.process.ts";
import type { TransactionBuildResult } from "@/core/service/executor/executor.types.ts";
import { CHANNEL_CLIENT } from "@/core/channel-client/index.ts";
import { UtxoBasedStellarAccount, UTXOStatus } from "@moonlight/moonlight-sdk";
import { OPEX_SK } from "@/config/env.ts";

const EXECUTOR_CONFIG = {
  OPEX_UTXO_BATCH_SIZE: 200,
  REQUIRED_OPEX_UTXOS: 1,
} as const;

/**
 * Builds a transaction from a slot containing multiple bundles
 * Aggregates all operations and calculates total fee
 * 
 * @param slot - Slot containing bundles to be sent in transaction
 * @returns Transaction builder ready to be signed and submitted
 */
export async function buildTransactionFromSlot(
  slot: Slot
): Promise<TransactionBuildResult> {
  const bundles = slot.getBundles();
  
  if (bundles.length === 0) {
    throw new Error("Cannot build transaction from empty slot");
  }

  // Setup transaction builder and OPEX handler
  const txBuilder = MoonlightTransactionBuilder.fromPrivacyChannel(CHANNEL_CLIENT);
  const opexHandler = UtxoBasedStellarAccount.fromPrivacyChannel({
    channelClient: CHANNEL_CLIENT,
    root: OPEX_SK,
    options: {
      batchSize: EXECUTOR_CONFIG.OPEX_UTXO_BATCH_SIZE,
    },
  });

  // Ensure OPEX has enough UTXOs
  await ensureOpexUtxosAvailable(opexHandler, EXECUTOR_CONFIG.REQUIRED_OPEX_UTXOS);
  const reservedUtxos = opexHandler.reserveUTXOs(EXECUTOR_CONFIG.REQUIRED_OPEX_UTXOS);
  
  if (!reservedUtxos || reservedUtxos.length === 0) {
    const availableCount = opexHandler.getUTXOsByState(UTXOStatus.FREE).length;
    throw new Error(`Insufficient UTXOs. Required: ${EXECUTOR_CONFIG.REQUIRED_OPEX_UTXOS}, Available: ${availableCount}`);
  }

  // Calculate total fee from all bundles
  const totalFee = bundles.reduce((sum, bundle) => sum + bundle.fee, BigInt(0));

  // Create fee operation
  const feeOperation = MoonlightOperation.create(
    reservedUtxos[0].publicKey,
    totalFee
  );
  txBuilder.addOperation(feeOperation);

  // Add all operations from all bundles
  for (const bundle of bundles) {
    // Add deposit operations
    bundle.operations.deposit.forEach((op) => {
      txBuilder.addOperation(op);
    });

    // Add create operations
    bundle.operations.create.forEach((op) => {
      txBuilder.addOperation(op);
    });

    // Add spend operations
    bundle.operations.spend.forEach((op) => {
      txBuilder.addOperation(op);
    });

    // Add withdraw operations
    bundle.operations.withdraw.forEach((op) => {
      txBuilder.addOperation(op);
    });
  }

  const bundleIds = bundles.map((b) => b.bundleId);

  return {
    txBuilder,
    totalFee,
    bundleIds,
  };
}

/**
 * Ensures OPEX account has enough free UTXOs available
 */
async function ensureOpexUtxosAvailable(
  opexHandler: UtxoBasedStellarAccount,
  requiredCount: number
): Promise<void> {
  while (opexHandler.getUTXOsByState(UTXOStatus.FREE).length < requiredCount + 1) {
    await opexHandler.deriveBatch({});
    await opexHandler.batchLoad();
  }
}
