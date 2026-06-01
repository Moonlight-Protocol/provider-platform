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
import { verifyEntityChallenge } from "@/core/service/auth/entity-auth.ts";
import type { Logger } from "@/utils/logger/index.ts";

const entityRepo = new EntityRepository(drizzleClient);
const accountRepo = new AccountRepository(drizzleClient);

const NAME_MAX_LEN = 250;

const signedChallengeSchema = z.object({
  nonce: z.string().min(1),
  signature: z.string().min(1),
});

const bodySchema = z.object({
  pubkey: z.string().min(1),
  name: z.string().min(1).max(NAME_MAX_LEN),
  jurisdictions: z.array(z.string()).default([]),
  signedChallenge: signedChallengeSchema,
});

/**
 * Strip HTML tags from a name string. The frontend should also sanitise
 * (defence in depth); this is the authoritative gate.
 *
 * Two rules:
 *   - Remove anything that looks like an HTML tag or its closing form.
 *   - Collapse whitespace and trim.
 *
 * After this the name is plain text. We never render it as HTML on this
 * platform, but downstream consumers (council-console, browser-wallet) might,
 * so the contract is "no markup, ever."
 */
function sanitiseName(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * POST /api/v1/providers/:ppPublicKey/entities
 *
 * Public KYC/KYB-style submission. Caller proves wallet ownership by signing
 * a previously-issued nonce (see POST /entities/challenge). On success the
 * entity is created or its existing record promoted to APPROVED, and a
 * USER-type account is created for the pubkey if one doesn't exist yet.
 *
 * The :ppPublicKey URL param is intentionally not loaded here — the PP exists
 * (the route mount verified that). What matters is the submitter's wallet
 * proof and the sanitised name/jurisdictions.
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
      const { pubkey, signedChallenge } = parsed.data;
      const name = sanitiseName(parsed.data.name);
      const jurisdictions = parsed.data.jurisdictions.map((j) => j.trim())
        .filter((j) => j.length > 0);

      if (name.length === 0) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = {
          message: "name must contain at least one non-tag character",
        };
        return;
      }

      const sigOk = await verifyEntityChallenge(
        pubkey,
        signedChallenge.nonce,
        signedChallenge.signature,
        { log },
      );
      if (!sigOk) {
        ctx.response.status = Status.Unauthorized;
        ctx.response.body = {
          message: "Invalid or expired signed challenge",
        };
        return;
      }

      log.debug("pubkey", pubkey);
      log.debug("nameLength", name.length);

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
