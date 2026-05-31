import { type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { PayKycRepository } from "@/persistence/drizzle/repository/pay-kyc.repository.ts";
import { PayKycStatus } from "@/persistence/drizzle/entity/pay-kyc.entity.ts";
import { claimEscrowForAddress } from "@/core/service/pay/escrow.service.ts";
import type { Logger } from "@/utils/logger/index.ts";

const kycRepo = new PayKycRepository(drizzleClient);

export function handlePostSimulateKyc(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("postSimulateKyc");

  return async (ctx) => {
    log.info("postSimulateKyc");
    try {
      const body = await ctx.request.body.json();
      const { address, jurisdiction } = body;

      if (!address || !jurisdiction) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = {
          message: "address and jurisdiction are required",
        };
        return;
      }

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

      const escrowResult = await claimEscrowForAddress(address, { log });

      log.debug("address", address);
      log.debug("escrowClaimed", escrowResult.claimed);
      log.debug("escrowAmount", escrowResult.totalAmount.toString());
      log.event("KYC simulated + escrow claimed");

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
      log.error(error, "simulate KYC failed");
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "Invalid request body" };
    }
  };
}
