import { type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { PayKycRepository } from "@/persistence/drizzle/repository/pay-kyc.repository.ts";
import { PayKycStatus } from "@/persistence/drizzle/entity/pay-kyc.entity.ts";

const kycRepo = new PayKycRepository(drizzleClient);

export const postKycHandler = async (ctx: Context) => {
  try {
    const body = await ctx.request.body.json();
    const { address, jurisdiction } = body;

    if (!address || !jurisdiction) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "address and jurisdiction are required" };
      return;
    }

    const existing = await kycRepo.findByAddress(address);
    if (existing) {
      await kycRepo.update(existing.id, {
        jurisdiction,
        status: PayKycStatus.PENDING,
        updatedAt: new Date(),
      });
    } else {
      await kycRepo.create({
        id: crypto.randomUUID(),
        address,
        jurisdiction,
        status: PayKycStatus.PENDING,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "KYC submitted",
      data: { status: PayKycStatus.PENDING },
    };
  } catch {
    ctx.response.status = Status.BadRequest;
    ctx.response.body = { message: "Invalid request body" };
  }
};
