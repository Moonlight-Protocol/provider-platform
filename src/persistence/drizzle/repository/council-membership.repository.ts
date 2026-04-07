import { eq, and, isNull, desc } from "drizzle-orm";
import { BaseRepository } from "@/persistence/drizzle/repository/base.repository.ts";
import {
  councilMembership,
  type CouncilMembership,
  type NewCouncilMembership,
  CouncilMembershipStatus,
} from "@/persistence/drizzle/entity/council-membership.entity.ts";
import type { DrizzleClient } from "@/persistence/drizzle/config.ts";

export class CouncilMembershipRepository extends BaseRepository<
  typeof councilMembership,
  CouncilMembership,
  NewCouncilMembership
> {
  constructor(db: DrizzleClient) {
    super(db, councilMembership);
  }

  async getActiveForPp(ppPublicKey: string): Promise<CouncilMembership | undefined> {
    const [result] = await this.db
      .select()
      .from(councilMembership)
      .where(
        and(
          eq(councilMembership.ppPublicKey, ppPublicKey),
          eq(councilMembership.status, CouncilMembershipStatus.ACTIVE),
          isNull(councilMembership.deletedAt),
        ),
      )
      .limit(1);
    return result;
  }

  async getPendingForPp(ppPublicKey: string): Promise<CouncilMembership | undefined> {
    const [result] = await this.db
      .select()
      .from(councilMembership)
      .where(
        and(
          eq(councilMembership.ppPublicKey, ppPublicKey),
          eq(councilMembership.status, CouncilMembershipStatus.PENDING),
          isNull(councilMembership.deletedAt),
        ),
      )
      .limit(1);
    return result;
  }

  async getCurrentForPp(ppPublicKey: string): Promise<CouncilMembership | undefined> {
    // Return ACTIVE first, then most recently updated (covers PENDING and REJECTED)
    const active = await this.getActiveForPp(ppPublicKey);
    if (active) return active;
    const [result] = await this.db
      .select()
      .from(councilMembership)
      .where(
        and(
          eq(councilMembership.ppPublicKey, ppPublicKey),
          isNull(councilMembership.deletedAt),
        ),
      )
      .orderBy(desc(councilMembership.updatedAt))
      .limit(1);
    return result;
  }

  async getPending(): Promise<CouncilMembership | undefined> {
    const [result] = await this.db
      .select()
      .from(councilMembership)
      .where(
        and(
          eq(councilMembership.status, CouncilMembershipStatus.PENDING),
          isNull(councilMembership.deletedAt),
        ),
      )
      .limit(1);
    return result;
  }

  async findByCouncilUrlAndPp(url: string, ppPublicKey: string): Promise<CouncilMembership | undefined> {
    const [result] = await this.db
      .select()
      .from(councilMembership)
      .where(
        and(
          eq(councilMembership.councilUrl, url),
          eq(councilMembership.ppPublicKey, ppPublicKey),
          isNull(councilMembership.deletedAt),
        ),
      )
      .limit(1);
    return result;
  }

  async findByJoinRequestId(joinRequestId: string): Promise<CouncilMembership | undefined> {
    const [result] = await this.db
      .select()
      .from(councilMembership)
      .where(
        and(
          eq(councilMembership.joinRequestId, joinRequestId),
          isNull(councilMembership.deletedAt),
        ),
      )
      .limit(1);
    return result;
  }

  async listAllForPp(ppPublicKey: string): Promise<CouncilMembership[]> {
    return await this.db
      .select()
      .from(councilMembership)
      .where(
        and(
          eq(councilMembership.ppPublicKey, ppPublicKey),
          isNull(councilMembership.deletedAt),
        ),
      )
      .orderBy(councilMembership.createdAt);
  }
}
