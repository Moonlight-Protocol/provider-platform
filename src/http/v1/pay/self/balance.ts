import { type Context, Status } from "@oak/oak";
import type { JwtSessionData } from "@/http/middleware/auth/index.ts";

/**
 * GET /pay/self/balance
 *
 * Returns UTXO balance summary for the authenticated self-custodial user.
 * TODO: Integrate with UTXO account handler for real balance derivation.
 */
export const getSelfBalanceHandler = (ctx: Context) => {
  const session = ctx.state.session as JwtSessionData;
  const _accountId = session.sub;

  // Placeholder — real implementation will query UTXOs derived from the user's key
  ctx.response.status = Status.OK;
  ctx.response.body = {
    message: "Balance retrieved",
    data: {
      totalBalance: "0",
      utxoCount: 0,
      freeSlots: 300,
    },
  };
};
