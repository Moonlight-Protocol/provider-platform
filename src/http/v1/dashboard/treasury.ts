import { type Context, Status } from "@oak/oak";
import { NETWORK_CONFIG } from "@/config/env.ts";
import type { PaymentProvider } from "@/persistence/drizzle/entity/pp.entity.ts";
import type { Logger } from "@/utils/logger/index.ts";

/**
 * GET /api/v1/providers/:ppPublicKey/treasury
 *
 * Returns the treasury (PP account) balance and info on Stellar.
 */
export function handleGetTreasury(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("getTreasury");

  return async (ctx) => {
    log.info("getTreasury");
    const pp = ctx.state.pp as PaymentProvider;

    const horizonUrl = NETWORK_CONFIG.horizonUrl;
    if (!horizonUrl) {
      ctx.response.status = Status.ServiceUnavailable;
      ctx.response.body = { message: "No Horizon URL configured" };
      return;
    }

    try {
      const response = await fetch(`${horizonUrl}/accounts/${pp.publicKey}`);

      if (!response.ok) {
        throw new Error(`Horizon returned ${response.status}`);
      }

      const accountData = await response.json();

      ctx.response.status = Status.OK;
      ctx.response.body = {
        message: "Treasury info retrieved",
        data: {
          address: pp.publicKey,
          sequence: accountData.sequence,
          balances: accountData.balances,
          lastModifiedLedger: accountData.last_modified_ledger,
        },
      };
    } catch (error) {
      log.error(error, "failed to fetch treasury balance");

      ctx.response.status = Status.ServiceUnavailable;
      ctx.response.body = {
        message: "Failed to fetch treasury info from network",
      };
    }
  };
}
