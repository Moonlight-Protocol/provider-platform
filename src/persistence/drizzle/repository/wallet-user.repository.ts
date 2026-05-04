import { eq } from "drizzle-orm";
import {
  type WalletUser,
  walletUser,
} from "@/persistence/drizzle/entity/wallet-user.entity.ts";
import type { DrizzleClient } from "@/persistence/drizzle/config.ts";

export class WalletUserRepository {
  constructor(private db: DrizzleClient) {}

  async findByPublicKey(publicKey: string): Promise<WalletUser | undefined> {
    const [result] = await this.db
      .select()
      .from(walletUser)
      .where(eq(walletUser.publicKey, publicKey))
      .limit(1);
    return result;
  }

  async findOrCreate(publicKey: string): Promise<WalletUser> {
    const existing = await this.findByPublicKey(publicKey);
    if (existing) return existing;

    const [created] = await this.db
      .insert(walletUser)
      .values({ publicKey })
      .onConflictDoNothing()
      .returning();

    // Race condition: another request might have inserted between our check and insert
    return created ?? (await this.findByPublicKey(publicKey))!;
  }
}
