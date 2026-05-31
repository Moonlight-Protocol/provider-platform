import { type Context, Status } from "@oak/oak";
import type { Logger } from "@/utils/logger/index.ts";

/**
 * POST /pay/report
 *
 * Receives error reports from moonlight-pay apps.
 * Logs them for now — a proper error tracking pipeline can be added later.
 */
export function handlePostReport(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("postReport");

  return async (ctx) => {
    log.info("postReport");
    try {
      const body = await ctx.request.body.json();
      const { description, steps, debug } = body;

      if (!description || typeof description !== "string") {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = {
          message: "description is required and must be a string",
        };
        return;
      }

      const truncate = (v: unknown, max: number) =>
        typeof v === "string" ? v.slice(0, max) : undefined;

      log.debug("description", truncate(description, 500));
      log.debug("steps", truncate(steps, 500));
      log.debug("userAgent", truncate(debug?.userAgent, 500));
      log.debug("url", truncate(debug?.url, 500));
      log.debug("timestamp", truncate(debug?.timestamp, 100));
      log.event("error report received");

      ctx.response.status = Status.OK;
      ctx.response.body = {
        message: "Report received",
        data: { id: crypto.randomUUID() },
      };
    } catch {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "Invalid request body" };
    }
  };
}
