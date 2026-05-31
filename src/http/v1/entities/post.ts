import { type Context, Status } from "@oak/oak";
import { z } from "zod";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { AccountRepository } from "@/persistence/drizzle/repository/account.repository.ts";
import { EntityRepository } from "@/persistence/drizzle/repository/entity.repository.ts";
import {
  EntityStatus,
  type NewAccount,
  type NewEntity,
} from "@/persistence/drizzle/entity/index.ts";
import type { Logger } from "@/utils/logger/index.ts";

const entityRepo = new EntityRepository(drizzleClient);
const accountRepo = new AccountRepository(drizzleClient);

const bodySchema = z.object({
  pubkey: z.string().min(1),
  name: z.string().min(1),
  jurisdictions: z.array(z.string()).default([]),
});

/**
 * POST /api/v1/entities
 *
 * Public KYC/KYB-style submission. Caller provides their pubkey + identity
 * data. Auto-accept: the entity is created (or its existing record promoted)
 * to APPROVED, and a USER-type account is created for the pubkey if one
 * doesn't exist yet.
 */
export function handlePostEntity(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("postEntity");

  return async (ctx) => {
    log.info("postEntity");
    try {
      const raw = await ctx.request.body.json();
      const parsed = bodySchema.safeParse(raw);
      if (!parsed.success) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = {
          message: "Invalid body",
          issues: parsed.error.issues,
        };
        return;
      }
      const { pubkey, name, jurisdictions } = parsed.data;
      log.debug("pubkey", pubkey);
      log.debug("name", name);

      log.event("checking for existing account");
      const existingAccount = await accountRepo.findById(pubkey);

      if (existingAccount) {
        const existingEntity = await entityRepo.findById(
          existingAccount.entityId,
        );
        if (existingEntity?.status === EntityStatus.APPROVED) {
          log.event("entity already approved for pubkey");
          ctx.response.status = Status.Conflict;
          ctx.response.body = {
            message: "Entity already approved for this pubkey",
            data: { pubkey, entityId: existingEntity.id },
          };
          return;
        }
        log.event("promoting existing entity to APPROVED");
        const updated = await entityRepo.update(existingAccount.entityId, {
          name,
          jurisdictions,
          status: EntityStatus.APPROVED,
        });
        log.debug("entityId", updated?.id ?? existingAccount.entityId);
        ctx.response.status = Status.OK;
        ctx.response.body = {
          message: "Entity updated",
          data: {
            pubkey,
            entityId: updated?.id ?? existingAccount.entityId,
            status: EntityStatus.APPROVED,
          },
        };
        return;
      }

      log.event("creating new entity + account");
      const newEntity = await entityRepo.create({
        id: crypto.randomUUID(),
        status: EntityStatus.APPROVED,
        name,
        jurisdictions,
      } as NewEntity);

      await accountRepo.create({
        id: pubkey,
        type: "USER",
        entityId: newEntity.id,
      } as NewAccount);

      log.debug("entityId", newEntity.id);
      log.event("entity registered and approved");
      ctx.response.status = Status.Created;
      ctx.response.body = {
        message: "Entity created",
        data: {
          pubkey,
          entityId: newEntity.id,
          status: EntityStatus.APPROVED,
        },
      };
    } catch (error) {
      log.error(error, "failed to create/update entity");
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { message: "Failed to create/update entity" };
    }
  };
}
