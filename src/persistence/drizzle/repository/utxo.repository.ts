import { and, eq, isNull } from "drizzle-orm";
import type { DrizzleClient } from "@/persistence/drizzle/config.ts";
import {
  type NewUtxo,
  type Utxo,
  utxo,
} from "@/persistence/drizzle/entity/utxo.entity.ts";
import { operationsBundle } from "@/persistence/drizzle/entity/operations-bundle.entity.ts";
import { BaseRepository } from "@/persistence/drizzle/repository/base.repository.ts";

export class UtxoRepository extends BaseRepository<
  typeof utxo,
  Utxo,
  NewUtxo
> {
  constructor(db: DrizzleClient) {
    super(db, utxo);
  }

  /**
   * Finds UTXOs by account_id
   */
  async findByAccountId(accountId: string) {
    return await this.db
      .select()
      .from(utxo)
      .where(
        and(
          eq(utxo.accountId, accountId),
          isNull(utxo.deletedAt),
        ),
      );
  }

  /**
   * Finds unspent UTXOs (spent_by_account_id is null)
   */
  async findUnspent() {
    return await this.db
      .select()
      .from(utxo)
      .where(
        and(
          isNull(utxo.spentByAccountId),
          isNull(utxo.deletedAt),
        ),
      );
  }

  /**
   * Finds UTXOs by created_at_bundle_id
   */
  async findByCreatedAtBundleId(bundleId: string) {
    return await this.db
      .select()
      .from(utxo)
      .where(
        and(
          eq(utxo.createdAtBundleId, bundleId),
          isNull(utxo.deletedAt),
        ),
      );
  }

  /**
   * Finds UTXOs by spent_at_bundle_id
   */
  async findBySpentAtBundleId(bundleId: string) {
    return await this.db
      .select()
      .from(utxo)
      .where(
        and(
          eq(utxo.spentAtBundleId, bundleId),
          isNull(utxo.deletedAt),
        ),
      );
  }

  /**
   * Unspent UTXOs whose creating bundle targeted the given privacy channel.
   * Joins via operations_bundles to scope by channel since UTXOs don't carry
   * the channel id directly.
   */
  async findUnspentByChannel(channelContractId: string) {
    return await this.db
      .select({
        id: utxo.id,
        amount: utxo.amount,
        accountId: utxo.accountId,
        createdAtBundleId: utxo.createdAtBundleId,
        createdAt: utxo.createdAt,
      })
      .from(utxo)
      .innerJoin(
        operationsBundle,
        eq(operationsBundle.id, utxo.createdAtBundleId),
      )
      .where(
        and(
          isNull(utxo.spentAtBundleId),
          isNull(utxo.deletedAt),
          eq(operationsBundle.channelContractId, channelContractId),
        ),
      );
  }
}
