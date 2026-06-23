import { type Context, Router } from "@oak/oak";
import type { Logger } from "@/utils/logger/index.ts";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { PpRepository } from "@/persistence/drizzle/repository/pp.repository.ts";
import { CouncilMembershipRepository } from "@/persistence/drizzle/repository/council-membership.repository.ts";
import { handleCouncilRemovalNotice } from "@/core/service/council-notify/handle-removal.ts";

// PP determines its own state via on-chain queries and the council's public
// membership-status endpoint. The one inbound endpoint here is a low-trust live
// signal from a council that a provider was removed — it triggers an immediate
// re-query+converge rather than being believed on its own.

export function buildCouncilRouter(deps: { log: Logger }): Router {
  const router = new Router();
  const log = deps.log.scope("council");

  // POST /api/v1/council/removed — "you were removed" notice from a council.
  // We re-query the council's authoritative membership-status endpoint and only
  // demote memberships the council confirms are gone. The on-chain event-watcher
  // remains the can't-miss path; this just reacts faster.
  router.post("/council/removed", async (ctx: Context) => {
    const body = await ctx.request.body.json().catch(() => null);
    const channelAuthId = body?.councilId ?? body?.channelAuthId;
    if (typeof channelAuthId !== "string" || channelAuthId.length === 0) {
      ctx.response.status = 400;
      ctx.response.body = { message: "councilId is required" };
      return;
    }

    const result = await handleCouncilRemovalNotice(channelAuthId, {
      ppRepo: new PpRepository(drizzleClient),
      membershipRepo: new CouncilMembershipRepository(drizzleClient),
      log,
    });

    ctx.response.status = 202;
    ctx.response.body = {
      status: "accepted",
      deactivated: result.deactivated.length,
    };
  });

  return router;
}
