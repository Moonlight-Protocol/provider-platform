import { eq, and, isNull } from "drizzle-orm";
import type { DrizzleClient } from "@/persistence/drizzle/config.ts";
import {
  payKyc,
  type PayKyc,
  type NewPayKyc,
} from "@/persistence/drizzle/entity/pay-kyc.entity.ts";
import { BaseRepository } from "@/persistence/drizzle/repository/base.repository.ts";

export class PayKycRepository extends BaseRepository<
  typeof payKyc,
  PayKyc,
  NewPayKyc
> {
  constructor(db: DrizzleClient) {
    super(db, payKyc);
  }

  async findByAddress(address: string): Promise<PayKyc | undefined> {
    const [result] = await this.db
      .select()
      .from(payKyc)
      .where(
        and(
          eq(payKyc.address, address),
          isNull(payKyc.deletedAt),
        )
      )
      .limit(1);
    return result;
  }
}
