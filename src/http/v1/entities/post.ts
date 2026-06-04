import { type Context, Status } from "@oak/oak";
import { z } from "zod";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { AccountRepository } from "@/persistence/drizzle/repository/account.repository.ts";
import { EntityRepository } from "@/persistence/drizzle/repository/entity.repository.ts";
import { PpEntityApprovalRepository } from "@/persistence/drizzle/repository/pp-entity-approval.repository.ts";
import {
  EntityStatus,
  type NewAccount,
  type NewEntity,
} from "@/persistence/drizzle/entity/index.ts";
import { verifyEntityChallenge } from "@/core/service/auth/entity-auth.ts";
import type { Logger } from "@/utils/logger/index.ts";

const entityRepo = new EntityRepository(drizzleClient);
const accountRepo = new AccountRepository(drizzleClient);
const ppApprovalRepo = new PpEntityApprovalRepository(drizzleClient);

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
 * entity is created/updated AND a per-PP approval row is upserted to APPROVED
 * for the pair (ppPublicKey, pubkey). Identity (name, jurisdictions) stays on
 * the global entity record; the per-PP gate lives on `pp_entity_approvals`.
 */
export function handlePostEntity(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("postEntity");

  return async (ctx) => {
    log.info("postEntity");
    try {
      const params =
        (ctx as unknown as { params?: { ppPublicKey?: string } }).params;
      const ppPublicKey = params?.ppPublicKey;
      if (!ppPublicKey || typeof ppPublicKey !== "string") {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = { message: "ppPublicKey path param is required" };
        return;
      }
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
      log.debug("ppPublicKey", ppPublicKey);
      log.debug("nameLength", name.length);

      // Identity record (global): create-or-update the entity + account.
      let entityId: string;
      const existingAccount = await accountRepo.findById(pubkey);
      if (existingAccount) {
        log.event("updating existing entity identity");
        const updated = await entityRepo.update(existingAccount.entityId, {
          name,
          jurisdictions,
        });
        entityId = updated?.id ?? existingAccount.entityId;
      } else {
        log.event("creating new entity + account");
        const newEntity = await entityRepo.create({
          id: crypto.randomUUID(),
          status: EntityStatus.UNVERIFIED,
          name,
          jurisdictions,
        } as NewEntity);
        await accountRepo.create({
          id: pubkey,
          type: "USER",
          entityId: newEntity.id,
        } as NewAccount);
        entityId = newEntity.id;
      }

      // Per-PP approval: upsert this (pp, account) pair to APPROVED.
      const existingApproval = await ppApprovalRepo.findByPpAndAccount(
        ppPublicKey,
        pubkey,
      );
      if (existingApproval) {
        if (existingApproval.status === EntityStatus.APPROVED) {
          log.event("pp approval already approved for pubkey");
          ctx.response.status = Status.Conflict;
          ctx.response.body = {
            message: "Entity already approved for this provider",
            data: {
              pubkey,
              ppPublicKey,
              entityId,
              status: EntityStatus.APPROVED,
            },
          };
          return;
        }
        log.event("promoting existing pp approval to APPROVED");
        await ppApprovalRepo.update(existingApproval.id, {
          status: EntityStatus.APPROVED,
        });
      } else {
        log.event("creating new pp approval (APPROVED)");
        await ppApprovalRepo.create({
          id: crypto.randomUUID(),
          ppPublicKey,
          accountPubkey: pubkey,
          status: EntityStatus.APPROVED,
        });
      }

      log.event("entity approved for pp");
      ctx.response.status = existingApproval ? Status.OK : Status.Created;
      ctx.response.body = {
        message: existingApproval
          ? "Entity approval updated"
          : "Entity approved",
        data: {
          pubkey,
          ppPublicKey,
          entityId,
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
