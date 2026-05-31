import { type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { PayKycRepository } from "@/persistence/drizzle/repository/pay-kyc.repository.ts";
import { PayCustodialAccountRepository } from "@/persistence/drizzle/repository/pay-custodial-account.repository.ts";
import { PayKycStatus } from "@/persistence/drizzle/entity/pay-kyc.entity.ts";
import type { JwtSessionData } from "@/http/middleware/auth/index.ts";
import type { Logger } from "@/utils/logger/index.ts";

const kycRepo = new PayKycRepository(drizzleClient);
const accountRepo = new PayCustodialAccountRepository(drizzleClient);

export function handlePostKyc(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("postKyc");

  return async (ctx) => {
    log.info("postKyc");
    try {
      const body = await ctx.request.body.json();
      const { address, jurisdiction } = body;

      log.debug("address", address);
      log.debug("jurisdiction", jurisdiction);

      if (!address || !jurisdiction) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = {
          message: "address and jurisdiction are required",
        };
        return;
      }

      const session = ctx.state.session as JwtSessionData;
      log.debug("sessionType", session.type);

      // Ownership check: ensure the address belongs to the authenticated user
      log.event("verifying address ownership");
      if (session.type === "custodial") {
        const account = await accountRepo.findById(session.sub);
        if (!account || account.depositAddress !== address) {
          ctx.response.status = Status.Forbidden;
          ctx.response.body = {
            message: "Address does not belong to this account",
          };
          return;
        }
      } else {
        if (address !== session.sub) {
          ctx.response.status = Status.Forbidden;
          ctx.response.body = {
            message: "Address does not match authenticated account",
          };
          return;
        }
      }

      log.event("looking up existing KYC record");
      const existing = await kycRepo.findByAddress(address);
      if (existing) {
        log.event("updating existing KYC record");
        await kycRepo.update(existing.id, {
          jurisdiction,
          status: PayKycStatus.PENDING,
          updatedAt: new Date(),
        });
      } else {
        log.event("creating new KYC record");
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
      log.event("KYC submission succeeded");
    } catch (error) {
      log.error(error, "post KYC failed");
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "Invalid request body" };
    }
  };
}
