import { MoonlightOperation, MoonlightTransactionBuilder } from "@moonlight/moonlight-sdk";
import type { Slot } from "@/core/service/mempool/mempool.process.ts";
import type { TransactionBuildResult } from "@/core/service/executor/executor.types.ts";
import { CHANNEL_CLIENT } from "@/core/channel-client/index.ts";
import { UtxoBasedStellarAccount, UTXOStatus } from "@moonlight/moonlight-sdk";
import { OPEX_SK } from "@/config/env.ts";
import { withSpan } from "@/core/tracing.ts";

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
  return withSpan("Executor.buildTransactionFromSlot", async (span) => {
    const bundles = slot.getBundles();

    if (bundles.length === 0) {
      throw new Error("Cannot build transaction from empty slot");
    }

    span.addEvent("setting_up_tx_builder", { "bundles.count": bundles.length });
    const txBuilder = MoonlightTransactionBuilder.fromPrivacyChannel(CHANNEL_CLIENT);
    const opexHandler = UtxoBasedStellarAccount.fromPrivacyChannel({
      channelClient: CHANNEL_CLIENT,
      root: OPEX_SK,
      options: {
        batchSize: EXECUTOR_CONFIG.OPEX_UTXO_BATCH_SIZE,
      },
    });

    span.addEvent("ensuring_opex_utxos");
    await ensureOpexUtxosAvailable(opexHandler, EXECUTOR_CONFIG.REQUIRED_OPEX_UTXOS);
    const reservedUtxos = opexHandler.reserveUTXOs(EXECUTOR_CONFIG.REQUIRED_OPEX_UTXOS);

    if (!reservedUtxos || reservedUtxos.length === 0) {
      const availableCount = opexHandler.getUTXOsByState(UTXOStatus.FREE).length;
      span.addEvent("insufficient_utxos", { "available": availableCount });
      throw new Error(`Insufficient UTXOs. Required: ${EXECUTOR_CONFIG.REQUIRED_OPEX_UTXOS}, Available: ${availableCount}`);
    }

    const totalFee = bundles.reduce((sum, bundle) => sum + bundle.fee, BigInt(0));
    span.addEvent("fee_calculated", { "fee.total": totalFee.toString() });

    const feeOperation = MoonlightOperation.create(
      reservedUtxos[0].publicKey,
      totalFee
    );
    txBuilder.addOperation(feeOperation);

    span.addEvent("adding_bundle_operations");
    for (const bundle of bundles) {
      bundle.operations.deposit.forEach((op) => txBuilder.addOperation(op));
      bundle.operations.create.forEach((op) => txBuilder.addOperation(op));
      bundle.operations.spend.forEach((op) => txBuilder.addOperation(op));
      bundle.operations.withdraw.forEach((op) => txBuilder.addOperation(op));
    }

    const bundleIds = bundles.map((b) => b.bundleId);
    span.addEvent("transaction_built", { "bundles.count": bundleIds.length });

    return {
      txBuilder,
      totalFee,
      bundleIds,
    };
  });
}

/**
 * Ensures OPEX account has enough free UTXOs available
 */
async function ensureOpexUtxosAvailable(
  opexHandler: UtxoBasedStellarAccount,
  requiredCount: number
): Promise<void> {
  return withSpan("Executor.ensureOpexUtxosAvailable", async (span) => {
    span.addEvent("checking_free_utxos", { "required": requiredCount });
    let iterations = 0;
    while (opexHandler.getUTXOsByState(UTXOStatus.FREE).length < requiredCount + 1) {
      iterations++;
      span.addEvent("deriving_batch", { "iteration": iterations });
      await opexHandler.deriveBatch({});
      await opexHandler.batchLoad();
    }
    span.addEvent("utxos_available", {
      "free.count": opexHandler.getUTXOsByState(UTXOStatus.FREE).length,
      "iterations": iterations,
    });
  });
}
