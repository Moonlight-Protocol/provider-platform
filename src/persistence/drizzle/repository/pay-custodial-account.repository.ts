import { and, eq, isNull } from "drizzle-orm";
import type { DrizzleClient } from "@/persistence/drizzle/config.ts";
import {
  type NewPayCustodialAccount,
  type PayCustodialAccount,
  payCustodialAccount,
} from "@/persistence/drizzle/entity/pay-custodial-account.entity.ts";
import { BaseRepository } from "@/persistence/drizzle/repository/base.repository.ts";

export class PayCustodialAccountRepository extends BaseRepository<
  typeof payCustodialAccount,
  PayCustodialAccount,
  NewPayCustodialAccount
> {
  constructor(db: DrizzleClient) {
    super(db, payCustodialAccount);
  }

  async findByUsername(
    username: string,
  ): Promise<PayCustodialAccount | undefined> {
    const [result] = await this.db
      .select()
      .from(payCustodialAccount)
      .where(
        and(
          eq(payCustodialAccount.username, username),
          isNull(payCustodialAccount.deletedAt),
        ),
      )
      .limit(1);
    return result;
  }

  async findByDepositAddress(
    address: string,
  ): Promise<PayCustodialAccount | undefined> {
    const [result] = await this.db
      .select()
      .from(payCustodialAccount)
      .where(
        and(
          eq(payCustodialAccount.depositAddress, address),
          isNull(payCustodialAccount.deletedAt),
        ),
      )
      .limit(1);
    return result;
  }
}
