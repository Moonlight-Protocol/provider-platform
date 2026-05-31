import type { Context } from "@oak/oak";
import type { Logger } from "@/utils/logger/index.ts";

export function appendRequestIdMiddleware(
  deps: { log: Logger },
): (ctx: Context, next: () => Promise<unknown>) => Promise<void> {
  const log = deps.log.scope("requestId");

  return async (ctx, next) => {
    const requestId = crypto.randomUUID();
    ctx.state.requestId = requestId;
    log.debug("requestId", requestId);
    log.event("incoming request");
    await next();
  };
}
