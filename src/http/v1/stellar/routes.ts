import { Router } from "@oak/oak";
import type { Logger } from "@/utils/logger/index.ts";
import { buildAuthRouter } from "@/http/v1/stellar/auth/routes.ts";

export function buildStellarRouter(deps: { log: Logger }): Router {
  const stellarRouter = new Router();
  const authRouter = buildAuthRouter(deps);
  stellarRouter.use(
    "/stellar",
    authRouter.routes(),
    authRouter.allowedMethods(),
  );
  return stellarRouter;
}
