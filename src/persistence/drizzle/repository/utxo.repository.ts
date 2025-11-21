import { eq, and, isNull } from "drizzle-orm";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { utxo, type Utxo, type NewUtxo } from "@/persistence/drizzle/entity/utxo.entity.ts";
import { BaseRepository } from "@/persistence/drizzle/repository/base.repository.ts";

export class UtxoRepository extends BaseRepository<
  typeof utxo,
  Utxo,
  NewUtxo
> {
  constructor() {
    super(drizzleClient, utxo);
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
          isNull(utxo.deletedAt)
        )
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
          isNull(utxo.deletedAt)
        )
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
          isNull(utxo.deletedAt)
        )
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
          isNull(utxo.deletedAt)
        )
      );
  }
}

