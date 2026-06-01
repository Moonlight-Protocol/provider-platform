import { type Context, Router, Status } from "@oak/oak";
import type { Logger } from "@/utils/logger/index.ts";

/**
 * Legacy /events/ws surface. The canonical event stream is now
 * GET /api/v1/providers/:ppPublicKey/events/ws. This stub returns 410 Gone
 * so callers migrate.
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

export function buildEventsRouter(_deps: { log: Logger }): Router {
  const eventsRouter = new Router();
  eventsRouter.get(
    "/events/ws",
    gone("GET /api/v1/providers/:ppPublicKey/events/ws"),
  );
  return eventsRouter;
}
