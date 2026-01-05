import { MoonlightOperation } from "@moonlight/moonlight-sdk";
import type { OperationsBundle } from "@/persistence/drizzle/entity/operations-bundle.entity.ts";
import type { SlotItem } from "@/core/service/mempool/types.ts";
import { classifyOperations } from "@/core/service/bundle/bundle.service.ts";
import type { UtxoRepository } from "@/persistence/drizzle/repository/utxo.repository.ts";
import { LOG } from "@/config/logger.ts";
import * as E from "@/core/service/mempool/mempool.errors.ts";
import { logAndThrow } from "@/utils/error/log-and-throw.ts";

/**
 * Builds a SlotItem from an OperationsBundle
 * Extracts and parses all necessary data for transaction construction
 */
export class SlotItemBuilder {
  constructor(
    private readonly utxoRepository: UtxoRepository
  ) {}

  /**
   * Builds a SlotItem from an OperationsBundle
   */
  async build(bundle: OperationsBundle): Promise<SlotItem> {
    // 1. Parse operations from MLXDR
    const operations = await Promise.all(
      bundle.operationsMLXDR.map((xdr) => MoonlightOperation.fromMLXDR(xdr))
    );

    if (operations.length === 0) {
      logAndThrow(new E.BUNDLE_HAS_NO_OPERATIONS(bundle.id));
    }

    // 2. Classify operations
    const classified = classifyOperations(operations);

    // 3. Fetch UTXOs from database
    // UTXOs should already be persisted when bundle is created
    const [inputUtxos, outputUtxos] = await Promise.all([
      this.utxoRepository.findBySpentAtBundleId(bundle.id),
      this.utxoRepository.findByCreatedAtBundleId(bundle.id),
    ]);

    // Log warnings if UTXOs are missing (may indicate data inconsistency)
    if (inputUtxos.length === 0 && classified.spend.length > 0) {
      LOG.warn(`No input UTXOs found for bundle ${bundle.id} with ${classified.spend.length} spend operations`);
    }
    if (outputUtxos.length === 0 && classified.create.length > 0) {
      LOG.warn(`No output UTXOs found for bundle ${bundle.id} with ${classified.create.length} create operations`);
    }

    LOG.debug(`Built SlotItem for bundle ${bundle.id}`, {
      operationsCount: operations.length,
      depositCount: classified.deposit.length,
      withdrawCount: classified.withdraw.length,
      createCount: classified.create.length,
      spendCount: classified.spend.length,
      inputUtxosCount: inputUtxos.length,
      outputUtxosCount: outputUtxos.length,
    });

    return {
      bundleId: bundle.id,
      fee: bundle.fee,
      createdAt: bundle.createdAt,
      ttl: bundle.ttl,
      operationsMLXDR: bundle.operationsMLXDR,
      operations: {
        deposit: classified.deposit,
        withdraw: classified.withdraw,
        create: classified.create,
        spend: classified.spend,
      },
      utxos: {
        inputs: inputUtxos,
        outputs: outputUtxos,
      },
    };
  }
}

