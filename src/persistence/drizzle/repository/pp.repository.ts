import { eq, and } from "drizzle-orm";
import { BaseRepository } from "@/persistence/drizzle/repository/base.repository.ts";
import {
  paymentProvider,
  type PaymentProvider,
  type NewPaymentProvider,
} from "@/persistence/drizzle/entity/pp.entity.ts";
import type { DrizzleClient } from "@/persistence/drizzle/config.ts";

export class PpRepository extends BaseRepository<
  typeof paymentProvider,
  PaymentProvider,
  NewPaymentProvider
> {
  constructor(db: DrizzleClient) {
    super(db, paymentProvider);
  }

  async findByPublicKey(publicKey: string): Promise<PaymentProvider | undefined> {
    const [result] = await this.db
      .select()
      .from(paymentProvider)
      .where(eq(paymentProvider.publicKey, publicKey))
      .limit(1);
    return result;
  }

  async listActive(): Promise<PaymentProvider[]> {
    return await this.db
      .select()
      .from(paymentProvider)
      .where(eq(paymentProvider.isActive, true));
  }

  async listAll(): Promise<PaymentProvider[]> {
    return await this.db
      .select()
      .from(paymentProvider)
      .orderBy(paymentProvider.createdAt);
  }

  async activate(id: string): Promise<PaymentProvider> {
    const [updated] = await this.db
      .update(paymentProvider)
      .set({ isActive: true, updatedAt: new Date() })
      .where(eq(paymentProvider.id, id))
      .returning();
    return updated;
  }

  async deactivate(id: string): Promise<void> {
    await this.db
      .update(paymentProvider)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(paymentProvider.id, id));
  }

  async hardDelete(id: string): Promise<void> {
    await this.db
      .delete(paymentProvider)
      .where(eq(paymentProvider.id, id));
  }

  async listByOwner(ownerPublicKey: string): Promise<PaymentProvider[]> {
    return await this.db
      .select()
      .from(paymentProvider)
      .where(eq(paymentProvider.ownerPublicKey, ownerPublicKey))
      .orderBy(paymentProvider.createdAt);
  }

  async findByPublicKeyAndOwner(publicKey: string, ownerPublicKey: string): Promise<PaymentProvider | undefined> {
    const [result] = await this.db
      .select()
      .from(paymentProvider)
      .where(
        and(
          eq(paymentProvider.publicKey, publicKey),
          eq(paymentProvider.ownerPublicKey, ownerPublicKey),
        ),
      )
      .limit(1);
    return result;
  }
}
