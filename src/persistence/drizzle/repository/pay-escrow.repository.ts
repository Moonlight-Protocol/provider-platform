import { and, desc, eq, isNull } from "drizzle-orm";
import type { DrizzleClient } from "@/persistence/drizzle/config.ts";
import {
  type NewPayEscrow,
  type PayEscrow,
  payEscrow,
  PayEscrowStatus,
} from "@/persistence/drizzle/entity/pay-escrow.entity.ts";
import { BaseRepository } from "@/persistence/drizzle/repository/base.repository.ts";

export class PayEscrowRepository extends BaseRepository<
  typeof payEscrow,
  PayEscrow,
  NewPayEscrow
> {
  constructor(db: DrizzleClient) {
    super(db, payEscrow);
  }

  /** Find all held escrow records for a given receiver address. */
  async findHeldForAddress(address: string): Promise<PayEscrow[]> {
    return await this.db
      .select()
      .from(payEscrow)
      .where(
        and(
          eq(payEscrow.heldForAddress, address),
          eq(payEscrow.status, PayEscrowStatus.HELD),
          isNull(payEscrow.deletedAt),
        ),
      )
      .orderBy(desc(payEscrow.createdAt));
  }

  /** Find all escrow records sent by a given address. */
  async findBySender(address: string): Promise<PayEscrow[]> {
    return await this.db
      .select()
      .from(payEscrow)
      .where(
        and(
          eq(payEscrow.senderAddress, address),
          isNull(payEscrow.deletedAt),
        ),
      )
      .orderBy(desc(payEscrow.createdAt));
  }
}
