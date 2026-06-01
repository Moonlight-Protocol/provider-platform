import { type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { PpRepository } from "@/persistence/drizzle/repository/pp.repository.ts";
import type { PaymentProvider } from "@/persistence/drizzle/entity/pp.entity.ts";
import type { Logger } from "@/utils/logger/index.ts";

let ppRepo = new PpRepository(drizzleClient);

export function setPpRepoForOwnershipTests(repo: PpRepository): void {
  ppRepo = repo;
}

interface SessionLike {
  sub?: string;
}

interface RouteParamsWithPp {
  ppPublicKey?: string;
}

export type RequirePpOwnershipState = {
  pp: PaymentProvider;
};

/**
 * Reads :ppPublicKey from the URL path, then verifies the authenticated
 * operator (ctx.state.session.sub) owns it. On success populates ctx.state.pp
 * for downstream handlers. The handler MUST NOT fall back to JWT / body /
 * query resolution.
 */
export function requirePpOwnership(
  deps: { log: Logger },
): (ctx: Context, next: () => Promise<unknown>) => Promise<void> {
  const log = deps.log.scope("requirePpOwnership");
  return async (ctx, next) => {
    const params = (ctx as unknown as { params?: RouteParamsWithPp }).params ??
      {};
    const ppPublicKey = params.ppPublicKey;
    if (!ppPublicKey || typeof ppPublicKey !== "string") {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = {
        message: "ppPublicKey is required in URL path",
      };
      return;
    }

    const session = ctx.state.session as SessionLike | undefined;
    if (!session?.sub) {
      ctx.response.status = Status.Unauthorized;
      ctx.response.body = { message: "Authentication required" };
      return;
    }

    const pp = await ppRepo.findByPublicKeyAndOwner(ppPublicKey, session.sub);
    if (!pp) {
      log.debug("ppPublicKey", ppPublicKey);
      log.event("PP not found or not owned by operator");
      ctx.response.status = Status.NotFound;
      ctx.response.body = { message: "Provider not found" };
      return;
    }

    ctx.state.pp = pp;
    await next();
  };
}

/**
 * Verifies the PP referenced by :ppPublicKey exists; populates ctx.state.pp.
 * Used by public per-PP endpoints (e.g. KYC/KYB submission) where JWT-based
 * ownership doesn't apply, but the URL must still point at a real PP.
 */
export function requirePpExists(
  deps: { log: Logger },
): (ctx: Context, next: () => Promise<unknown>) => Promise<void> {
  const log = deps.log.scope("requirePpExists");
  return async (ctx, next) => {
    const params = (ctx as unknown as { params?: RouteParamsWithPp }).params ??
      {};
    const ppPublicKey = params.ppPublicKey;
    if (!ppPublicKey || typeof ppPublicKey !== "string") {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = {
        message: "ppPublicKey is required in URL path",
      };
      return;
    }
    const pp = await ppRepo.findByPublicKey(ppPublicKey);
    if (!pp) {
      log.debug("ppPublicKey", ppPublicKey);
      log.event("PP not found");
      ctx.response.status = Status.NotFound;
      ctx.response.body = { message: "Provider not found" };
      return;
    }
    ctx.state.pp = pp;
    await next();
  };
}
