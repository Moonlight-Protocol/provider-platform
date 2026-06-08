import { Router } from "@oak/oak";
import type { Logger } from "@/utils/logger/index.ts";
import { handlePostChallenge } from "./auth/challenge.ts";
import { handlePostVerify } from "./auth/verify.ts";
import { handleDiscoverCouncil } from "./council.ts";
import { handleListPps, handleRegisterPp } from "./pp.ts";
import { jwtMiddleware } from "@/http/middleware/auth/index.ts";

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

  return dashboardRouter;
}
