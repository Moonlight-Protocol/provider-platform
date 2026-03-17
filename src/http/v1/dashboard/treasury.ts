import { type Context, Status } from "@oak/oak";
import { OPEX_SIGNER, NETWORK_CONFIG } from "@/config/env.ts";
import { LOG } from "@/config/logger.ts";

/**
 * GET /dashboard/treasury
 *
 * Returns the OpEx (treasury) account balance and info.
 * Queries Horizon for full account data including balances.
 */
export const getTreasuryHandler = async (ctx: Context) => {
  const opexAddress = OPEX_SIGNER.publicKey();
  const horizonUrl = NETWORK_CONFIG.horizonUrl;

  if (!horizonUrl) {
    ctx.response.status = Status.ServiceUnavailable;
    ctx.response.body = { message: "No Horizon URL configured" };
    return;
  }

  try {
    const response = await fetch(`${horizonUrl}/accounts/${opexAddress}`);

    if (!response.ok) {
      throw new Error(`Horizon returned ${response.status}`);
    }

    const accountData = await response.json();

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Treasury info retrieved",
      data: {
        address: opexAddress,
        sequence: accountData.sequence,
        balances: accountData.balances,
        lastModifiedLedger: accountData.last_modified_ledger,
      },
    };
  } catch (error) {
    LOG.error("Failed to fetch treasury balance", {
      error: error instanceof Error ? error.message : String(error),
    });

    ctx.response.status = Status.ServiceUnavailable;
    ctx.response.body = {
      message: "Failed to fetch treasury info from network",
    };
  }
};
