import { and, eq, isNull } from "drizzle-orm";
import type { DrizzleClient } from "@/persistence/drizzle/config.ts";
import {
  type Entity,
  entity,
  type EntityStatus,
  type NewEntity,
} from "@/persistence/drizzle/entity/entity.entity.ts";
import { BaseRepository } from "@/persistence/drizzle/repository/base.repository.ts";

export class EntityRepository
  extends BaseRepository<typeof entity, Entity, NewEntity> {
  constructor(db: DrizzleClient) {
    super(db, entity);
  }

  /**
   * Finds entities by status
   */
  async findByStatus(status: EntityStatus) {
    return await this.db
      .select()
      .from(entity)
      .where(and(eq(entity.status, status), isNull(entity.deletedAt)));
  }
}
