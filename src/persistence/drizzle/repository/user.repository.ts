import { eq, and, isNull } from "drizzle-orm";
import type { DrizzleClient } from "@/persistence/drizzle/config.ts";
import { user, type User, type NewUser, UserStatus } from "@/persistence/drizzle/entity/user.entity.ts";
import { BaseRepository } from "@/persistence/drizzle/repository/base.repository.ts";

export class UserRepository extends BaseRepository<
  typeof user,
  User,
  NewUser
> {
  constructor(db: DrizzleClient) {
    super(db, user);
  }

  /**
   * Finds users by status
   */
  async findByStatus(status: UserStatus) {
    return await this.db
      .select()
      .from(user)
      .where(
        and(
          eq(user.status, status),
          isNull(user.deletedAt)
        )
      );
  }
}

