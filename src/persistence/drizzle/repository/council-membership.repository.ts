import { eq, and, isNull } from "drizzle-orm";
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

  async getActive(): Promise<CouncilMembership | undefined> {
    const [result] = await this.db
      .select()
      .from(councilMembership)
      .where(
        and(
          eq(councilMembership.status, CouncilMembershipStatus.ACTIVE),
          isNull(councilMembership.deletedAt),
        ),
      )
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

  async getCurrent(): Promise<CouncilMembership | undefined> {
    // Return ACTIVE first, then PENDING
    const active = await this.getActive();
    if (active) return active;
    return this.getPending();
  }

  async findByCouncilUrl(url: string): Promise<CouncilMembership | undefined> {
    const [result] = await this.db
      .select()
      .from(councilMembership)
      .where(
        and(
          eq(councilMembership.councilUrl, url),
          isNull(councilMembership.deletedAt),
        ),
      )
      .limit(1);
    return result;
  }
}
