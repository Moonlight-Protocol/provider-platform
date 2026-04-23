import { eq } from "drizzle-orm";
import { BaseRepository } from "@/persistence/drizzle/repository/base.repository.ts";
import {
  waitlistRequest,
  type WaitlistRequest,
  type NewWaitlistRequest,
} from "@/persistence/drizzle/entity/waitlist-request.entity.ts";
import type { DrizzleClient } from "@/persistence/drizzle/config.ts";

export class WaitlistRequestRepository extends BaseRepository<
  typeof waitlistRequest,
  WaitlistRequest,
  NewWaitlistRequest
> {
  constructor(db: DrizzleClient) {
    super(db, waitlistRequest);
  }

  /**
   * Upsert by wallet public key.
   * If the wallet already exists, update the email and return the existing row.
   * Returns { row, isNew }.
   */
  async upsert(data: {
    email: string;
    walletPublicKey: string | null;
    source: string;
  }): Promise<{ row: WaitlistRequest; isNew: boolean }> {
    // If no wallet, always insert (can't dedup without wallet)
    if (!data.walletPublicKey) {
      const row = await this.create({
        id: crypto.randomUUID(),
        email: data.email,
        walletPublicKey: null,
        source: data.source,
      });
      return { row, isNew: true };
    }

    // Check for existing entry by wallet
    const [existing] = await this.db
      .select()
      .from(waitlistRequest)
      .where(eq(waitlistRequest.walletPublicKey, data.walletPublicKey))
      .limit(1);

    if (existing) {
      // Update email, return existing
      const [updated] = await this.db
        .update(waitlistRequest)
        .set({ email: data.email, updatedAt: new Date() })
        .where(eq(waitlistRequest.id, existing.id))
        .returning();
      return { row: updated, isNew: false };
    }

    const row = await this.create({
      id: crypto.randomUUID(),
      email: data.email,
      walletPublicKey: data.walletPublicKey,
      source: data.source,
    });
    return { row, isNew: true };
  }
}
