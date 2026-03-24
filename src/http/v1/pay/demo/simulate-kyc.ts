import { type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { PayKycRepository } from "@/persistence/drizzle/repository/pay-kyc.repository.ts";
import { PayKycStatus } from "@/persistence/drizzle/entity/pay-kyc.entity.ts";
import { claimEscrowForAddress } from "@/core/service/pay/escrow.service.ts";
import { LOG } from "@/config/logger.ts";

const kycRepo = new PayKycRepository(drizzleClient);

export const postSimulateKycHandler = async (ctx: Context) => {
  try {
    const body = await ctx.request.body.json();
    const { address, jurisdiction } = body;

    if (!address || !jurisdiction) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "address and jurisdiction are required" };
      return;
    }

    // Set KYC to VERIFIED
    const existing = await kycRepo.findByAddress(address);
    if (existing) {
      await kycRepo.update(existing.id, {
        status: PayKycStatus.VERIFIED,
        jurisdiction,
        verifiedAt: new Date(),
        updatedAt: new Date(),
      });
    } else {
      await kycRepo.create({
        id: crypto.randomUUID(),
        address,
        status: PayKycStatus.VERIFIED,
        jurisdiction,
        verifiedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    // Claim any held escrow for this address
    const escrowResult = await claimEscrowForAddress(address);

    LOG.info("KYC simulated + escrow claimed", {
      address,
      escrowClaimed: escrowResult.claimed,
      escrowAmount: escrowResult.totalAmount.toString(),
    });

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "KYC simulated",
      data: {
        status: "VERIFIED",
        escrowClaimed: escrowResult.claimed,
        escrowAmount: escrowResult.totalAmount.toString(),
      },
    };
  } catch (error) {
    LOG.warn("Simulate KYC failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.response.status = Status.BadRequest;
    ctx.response.body = { message: "Invalid request body" };
  }
};
