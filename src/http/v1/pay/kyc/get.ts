import { type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { PayKycRepository } from "@/persistence/drizzle/repository/pay-kyc.repository.ts";
import { LOG } from "@/config/logger.ts";

const kycRepo = new PayKycRepository(drizzleClient);

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
