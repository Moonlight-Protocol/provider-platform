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

    if (!description) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "description is required" };
      return;
    }

    LOG.info("Error report received", {
      description: description.slice(0, 500),
      steps: steps?.slice(0, 500),
      userAgent: debug?.userAgent,
      url: debug?.url,
      timestamp: debug?.timestamp,
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
