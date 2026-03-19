import { type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { PayKycRepository } from "@/persistence/drizzle/repository/pay-kyc.repository.ts";

const kycRepo = new PayKycRepository(drizzleClient);

type RouteParams = { address?: string };

export const getKycHandler = async (ctx: Context) => {
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
};
