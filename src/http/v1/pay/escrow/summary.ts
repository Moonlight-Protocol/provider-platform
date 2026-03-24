import { type Context, Status } from "@oak/oak";
import { getEscrowSummary } from "@/core/service/pay/escrow.service.ts";
import { LOG } from "@/config/logger.ts";

type RouteParams = { address?: string };

export const getEscrowSummaryHandler = async (ctx: Context) => {
  try {
    const params = (ctx as unknown as { params?: RouteParams }).params;
    const address = params?.address;

    if (!address) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "Address is required" };
      return;
    }

    const summary = await getEscrowSummary(address);

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Escrow summary retrieved",
      data: {
        count: summary.count,
        totalAmount: summary.totalAmount.toString(),
      },
    };
  } catch (error) {
    LOG.warn("Get escrow summary failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to retrieve escrow summary" };
  }
};
