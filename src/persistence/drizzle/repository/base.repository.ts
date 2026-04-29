// deno-lint-ignore-file no-explicit-any
//TODO: Remove no-explicit-any after fixing Drizzle types
// unknown should be used instead of any where possible
import { and, eq, isNull, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { DrizzleClient } from "@/persistence/drizzle/config.ts";

/**
 * Abstract base class for repositories with generic CRUD methods
 */
export abstract class BaseRepository<
  TTable extends PgTable,
  TSelect = any,
  TInsert = any,
> {
  constructor(
    protected readonly db: DrizzleClient,
    protected readonly table: TTable,
  ) {}

  /**
   * Inserts a new record
   */
  async create(data: TInsert): Promise<TSelect> {
    const result = await this.db
      .insert(this.table)
      .values(data as any)
      .returning();
    return result[0] as TSelect;
  }

  /**
   * Finds a record by ID (excluding soft deleted)
   */
  async findById(id: string): Promise<TSelect | undefined> {
    const [result] = await this.db
      .select()
      .from(this.table as any)
      .where(
        and(
          eq((this.table as any).id, id),
          isNull((this.table as any).deletedAt),
        ) as SQL<unknown>,
      )
      .limit(1);
    return result as TSelect | undefined;
  }

  /**
   * Finds multiple records (excluding soft deleted)
   */
  async findMany(conditions?: SQL<unknown>): Promise<TSelect[]> {
    const whereConditions = conditions
      ? (and(conditions, isNull((this.table as any).deletedAt)) as SQL<unknown>)
      : (isNull((this.table as any).deletedAt) as SQL<unknown>);

    return (await this.db
      .select()
      .from(this.table as any)
      .where(whereConditions)) as TSelect[];
  }

  /**
   * Updates a record by ID
   */
  async update(id: string, data: Partial<TInsert>): Promise<TSelect> {
    const updateData = {
      ...data,
      updatedAt: new Date(),
    } as any;

    const result = await this.db
      .update(this.table)
      .set(updateData)
      .where(eq((this.table as any).id, id) as SQL<unknown>)
      .returning();
    return result as TSelect;
  }

  /**
   * Performs soft delete (marks deleted_at with current timestamp)
   */
  async delete(id: string): Promise<void> {
    await this.db
      .update(this.table)
      .set({
        deletedAt: new Date(),
      } as any)
      .where(eq((this.table as any).id, id) as SQL<unknown>);
  }
}
