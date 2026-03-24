import { eq, and, isNull } from "drizzle-orm";
import type { DrizzleClient } from "@/persistence/drizzle/config.ts";
import { session, type Session, type NewSession } from "@/persistence/drizzle/entity/session.entity.ts";
import { BaseRepository } from "@/persistence/drizzle/repository/base.repository.ts";
import { SessionStatus } from "@/persistence/drizzle/entity/session.entity.ts";

export class SessionRepository extends BaseRepository<
  typeof session,
  Session,
  NewSession
> {
  constructor(db: DrizzleClient) {
    super(db, session);
  }

  /**
   * Finds sessions by user_id
   */
  async findByUserId(userId: string) {
    return await this.db
      .select()
      .from(session)
      .where(
        and(
          eq(session.accountId, userId),
          isNull(session.deletedAt)
        )
      );
  }

  /**
   * Finds session by jwt_token
   */
  async findByJwtToken(jwtToken: string) {
    const [result] = await this.db
      .select()
      .from(session)
      .where(
        and(
          eq(session.jwtToken, jwtToken),
          isNull(session.deletedAt)
        )
      )
      .limit(1);
    return result;
  }

  /**
   * Finds active sessions
   */
  async findActive() {
    return await this.db
      .select()
      .from(session)
      .where(
        and(
          eq(session.status, SessionStatus.ACTIVE),
          isNull(session.deletedAt)
        )
      );
  }
}

