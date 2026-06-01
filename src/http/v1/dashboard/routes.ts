import { type Context, Router, Status } from "@oak/oak";
import type { Logger } from "@/utils/logger/index.ts";
import { handlePostChallenge } from "./auth/challenge.ts";
import { handlePostVerify } from "./auth/verify.ts";
import { handleDiscoverCouncil } from "./council.ts";
import { handleListPps, handleRegisterPp } from "./pp.ts";
import { jwtMiddleware } from "@/http/middleware/auth/index.ts";

/**
 * Per-PP endpoints whose canonical home is /providers/:ppPublicKey/... now
 * answer 410 Gone here. The body names the new URL pattern so callers can
 * migrate. This is a temporary deprecation surface; a follow-up PR removes
 * these stubs once metrics confirm zero traffic.
 *
 * Two routes are bare-deleted instead of stubbed (per PM scope decision):
 *   - POST /dashboard/bundles/expire (no external callers; admin-only)
 *   - GET  /dashboard/bundles        (duplicated by PR #106's URL-scoped variant)
 */
function gone(newPath: string): (ctx: Context) => void {
  return (ctx) => {
    ctx.response.status = Status.Gone;
    ctx.response.body = {
      message:
        `This endpoint has moved. Use ${newPath} (per-PP URL-scoped path).`,
    };
  };
}

export function buildDashboardRouter(deps: { log: Logger }): Router {
  const dashboardRouter = new Router();

  // --- Auth (public, NOT per-PP) ---
  dashboardRouter.post("/dashboard/auth/challenge", handlePostChallenge(deps));
  dashboardRouter.post("/dashboard/auth/verify", handlePostVerify(deps));

  // --- PP management surface that is NOT per-PP ---
  dashboardRouter.post(
    "/dashboard/pp/register",
    jwtMiddleware(deps),
    handleRegisterPp(deps),
  );
  dashboardRouter.get(
    "/dashboard/pp/list",
    jwtMiddleware(deps),
    handleListPps(deps),
  );

  // --- Council surface that is NOT per-PP (operates on councilUrl only) ---
  dashboardRouter.post(
    "/dashboard/council/discover",
    jwtMiddleware(deps),
    handleDiscoverCouncil(deps),
  );

  // --- 410 Gone stubs for migrated per-PP routes ---
  dashboardRouter.post(
    "/dashboard/pp/delete",
    gone("DELETE /api/v1/providers/:ppPublicKey"),
  );
  dashboardRouter.get(
    "/dashboard/channels",
    gone("GET /api/v1/providers/:ppPublicKey/channels"),
  );
  dashboardRouter.get(
    "/dashboard/mempool",
    gone("GET /api/v1/providers/:ppPublicKey/mempool"),
  );
  dashboardRouter.get(
    "/dashboard/operations",
    gone("GET /api/v1/providers/:ppPublicKey/operations"),
  );
  dashboardRouter.get(
    "/dashboard/treasury",
    gone("GET /api/v1/providers/:ppPublicKey/treasury"),
  );
  dashboardRouter.get(
    "/dashboard/utxos",
    gone("GET /api/v1/providers/:ppPublicKey/utxos?channelContractId=..."),
  );
  dashboardRouter.get(
    "/dashboard/transactions",
    gone("GET /api/v1/providers/:ppPublicKey/transactions"),
  );
  dashboardRouter.get(
    "/dashboard/transactions/:id",
    gone("GET /api/v1/providers/:ppPublicKey/transactions/:id"),
  );
  dashboardRouter.get(
    "/dashboard/bundles/:id",
    gone("GET /api/v1/providers/:ppPublicKey/bundles/:id"),
  );
  dashboardRouter.get(
    "/dashboard/audit-export",
    gone("GET /api/v1/providers/:ppPublicKey/audit-export"),
  );
  dashboardRouter.get(
    "/dashboard/metrics",
    gone("GET /api/v1/providers/:ppPublicKey/metrics"),
  );
  dashboardRouter.post(
    "/dashboard/council/join",
    gone("POST /api/v1/providers/:ppPublicKey/council/join"),
  );
  dashboardRouter.get(
    "/dashboard/council/membership",
    gone("GET /api/v1/providers/:ppPublicKey/council/membership"),
  );
  dashboardRouter.post(
    "/dashboard/council/membership",
    gone("POST /api/v1/providers/:ppPublicKey/council/membership"),
  );

  // NOTE: POST /dashboard/bundles/expire and GET /dashboard/bundles (query
  // variant) are intentionally NOT registered here — bare-deleted per PM
  // scope. The canonical bundle list endpoints are URL-scoped:
  //   GET /providers/:ppPublicKey/bundles               (provider/operator view)
  //   GET /providers/:ppPublicKey/entity/bundles        (entity/submitter view)

  return dashboardRouter;
}
