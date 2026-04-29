import { type Context, Status } from "@oak/oak";
import { LOG } from "@/config/logger.ts";

/**
 * POST /pay/report
 *
 * Receives error reports from moonlight-pay apps.
 * Logs them for now — a proper error tracking pipeline can be added later.
 */
export const postReportHandler = async (ctx: Context) => {
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

    LOG.info("Error report received", {
      description: truncate(description, 500),
      steps: truncate(steps, 500),
      userAgent: truncate(debug?.userAgent, 500),
      url: truncate(debug?.url, 500),
      timestamp: truncate(debug?.timestamp, 100),
    });

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
