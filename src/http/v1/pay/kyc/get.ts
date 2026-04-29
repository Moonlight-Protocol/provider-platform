import { type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { PayKycRepository } from "@/persistence/drizzle/repository/pay-kyc.repository.ts";
import { PayCustodialAccountRepository } from "@/persistence/drizzle/repository/pay-custodial-account.repository.ts";
import type { JwtSessionData } from "@/http/middleware/auth/index.ts";
import { LOG } from "@/config/logger.ts";

const kycRepo = new PayKycRepository(drizzleClient);
const accountRepo = new PayCustodialAccountRepository(drizzleClient);

type RouteParams = { address?: string };

export const getKycHandler = async (ctx: Context) => {
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
        ctx.response.body = {
          message: "Address does not belong to this account",
        };
        return;
      }
    } else if (!session.type || session.type === "sep10") {
      if (address !== session.sub) {
        ctx.response.status = Status.Forbidden;
        ctx.response.body = {
          message: "Address does not match authenticated account",
        };
        return;
      }
    } else {
      ctx.response.status = Status.Forbidden;
      ctx.response.body = { message: "Unknown session type" };
      return;
    }

    const kyc = await kycRepo.findByAddress(address);

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "KYC status retrieved",
      data: {
        status: kyc?.status ?? "NONE",
        jurisdiction: kyc?.jurisdiction ?? null,
      },
    };
  } catch (error) {
    LOG.warn("Get KYC status failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to retrieve KYC status" };
  }
};
