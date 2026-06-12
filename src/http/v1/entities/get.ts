import { type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { PpEntityApprovalRepository } from "@/persistence/drizzle/repository/pp-entity-approval.repository.ts";
import type { PaymentProvider } from "@/persistence/drizzle/entity/pp.entity.ts";
import type { Logger } from "@/utils/logger/index.ts";

let approvalRepo = new PpEntityApprovalRepository(drizzleClient);

/** Test-only seam to inject a repo backed by the PGlite test DB. */
export function setEntitiesRepoForTests(
  repo: PpEntityApprovalRepository,
): void {
  approvalRepo = repo;
}

/**
 * GET /api/v1/providers/:ppPublicKey/entities
 *
 * Operator view of every entity that has interacted with this PP: the ones
 * approved via KYC self-serve plus the unauthorized pubkeys recorded at the
 * SEP-10 connect + bundle-submit-403 gates. Ownership is enforced upstream by
 * requirePpOwnership (PP comes from ctx.state.pp). Newest interaction first.
 */
export function handleGetEntities(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("getEntities");

  return async (ctx) => {
    log.info("getEntities");
    const pp = ctx.state.pp as PaymentProvider;

    log.event("listing entity interactions for PP");
    const rows = await approvalRepo.listByPp(pp.publicKey);
    log.debug("entityCount", rows.length);

    ctx.response.status = Status.OK;
    ctx.response.body = {
      data: rows.map((row) => ({
        pubkey: row.accountPubkey,
        status: row.status,
        name: row.name,
        jurisdictions: row.jurisdictions,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
    };
    log.event("entities response assembled");
  };
}
