import { type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { PayKycRepository } from "@/persistence/drizzle/repository/pay-kyc.repository.ts";
import { PayCustodialAccountRepository } from "@/persistence/drizzle/repository/pay-custodial-account.repository.ts";
import { PayKycStatus } from "@/persistence/drizzle/entity/pay-kyc.entity.ts";
import type { JwtSessionData } from "@/http/middleware/auth/index.ts";

const kycRepo = new PayKycRepository(drizzleClient);
const accountRepo = new PayCustodialAccountRepository(drizzleClient);

export const postKycHandler = async (ctx: Context) => {
  try {
    const body = await ctx.request.body.json();
    const { address, jurisdiction } = body;

    if (!address || !jurisdiction) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "address and jurisdiction are required" };
      return;
    }

    const session = ctx.state.session as JwtSessionData;

    // Ownership check: ensure the address belongs to the authenticated user
    if (session.type === "custodial") {
      // For custodial users, session.sub is the account UUID — look up the deposit address
      const account = await accountRepo.findById(session.sub);
      if (!account || account.depositAddress !== address) {
        ctx.response.status = Status.Forbidden;
        ctx.response.body = { message: "Address does not belong to this account" };
        return;
      }
    } else {
      // For self-custodial (SEP-10), session.sub IS the Stellar address
      if (address !== session.sub) {
        ctx.response.status = Status.Forbidden;
        ctx.response.body = { message: "Address does not match authenticated account" };
        return;
      }
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
