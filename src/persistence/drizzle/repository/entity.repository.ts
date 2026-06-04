import type { DrizzleClient } from "@/persistence/drizzle/config.ts";
import {
  type Entity,
  entity,
  type NewEntity,
} from "@/persistence/drizzle/entity/entity.entity.ts";
import { BaseRepository } from "@/persistence/drizzle/repository/base.repository.ts";

export class EntityRepository
  extends BaseRepository<typeof entity, Entity, NewEntity> {
  constructor(db: DrizzleClient) {
    super(db, entity);
  }
}
