import type { Context } from "@oak/oak";
import { LOG } from "@/config/logger.ts";

export async function appendRequestIdMiddleware(
  ctx: Context,
  next: () => Promise<unknown>
) {
  const requestId = crypto.randomUUID();
  ctx.state.requestId = requestId;
  LOG.info("Incoming request with ID:", { requestId });
  await next();
}
