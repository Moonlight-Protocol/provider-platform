import { type Context, Router, Status } from "@oak/oak";
import type { Logger } from "@/utils/logger/index.ts";

/**
 * Legacy /entities surface. The canonical KYC/KYB endpoint is now
 * POST /api/v1/providers/:ppPublicKey/entities (with a SEP-53 signedChallenge).
 * This stub returns 410 Gone so callers migrate.
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

export function buildEntitiesRouter(_deps: { log: Logger }): Router {
  const entitiesRouter = new Router();
  entitiesRouter.post(
    "/entities",
    gone("POST /api/v1/providers/:ppPublicKey/entities"),
  );
  return entitiesRouter;
}
