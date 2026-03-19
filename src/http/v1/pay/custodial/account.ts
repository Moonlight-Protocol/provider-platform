import { type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { PayCustodialAccountRepository } from "@/persistence/drizzle/repository/pay-custodial-account.repository.ts";
import type { JwtSessionData } from "@/http/middleware/auth/index.ts";

const accountRepo = new PayCustodialAccountRepository(drizzleClient);

export const getCustodialAccountHandler = async (ctx: Context) => {
  const session = ctx.state.session as JwtSessionData;
  const accountId = session.sub;

  const account = await accountRepo.findById(accountId);
  if (!account) {
    ctx.response.status = Status.NotFound;
    ctx.response.body = { message: "Account not found" };
    return;
  }

  ctx.response.status = Status.OK;
  ctx.response.body = {
    message: "Account retrieved",
    data: {
      id: account.id,
      depositAddress: account.depositAddress,
      balance: account.balance.toString(),
      status: account.status.toLowerCase(),
    },
  };
};
