import { type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { PayCustodialAccountRepository } from "@/persistence/drizzle/repository/pay-custodial-account.repository.ts";
import { getEscrowSummary } from "@/core/service/pay/escrow.service.ts";
import type { JwtSessionData } from "@/http/middleware/auth/index.ts";
import { LOG } from "@/config/logger.ts";

const accountRepo = new PayCustodialAccountRepository(drizzleClient);

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

    // Ownership check: ensure the address belongs to the authenticated user
    const session = ctx.state.session as JwtSessionData;
    if (session.type === "custodial") {
      const account = await accountRepo.findById(session.sub);
      if (!account || account.depositAddress !== address) {
        ctx.response.status = Status.Forbidden;
        ctx.response.body = { message: "Address does not belong to this account" };
        return;
      }
    } else if (address !== session.sub) {
      ctx.response.status = Status.Forbidden;
      ctx.response.body = { message: "Address does not match authenticated account" };
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
