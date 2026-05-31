import { type Context, Status } from "@oak/oak";
import { NETWORK_CONFIG } from "@/config/env.ts";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { PpRepository } from "@/persistence/drizzle/repository/pp.repository.ts";
import type { Logger } from "@/utils/logger/index.ts";

const ppRepo = new PpRepository(drizzleClient);

/**
 * GET /dashboard/treasury?ppPublicKey=G...
 *
 * Returns the treasury (PP account) balance and info.
 * Each PP's public key is its on-chain account address.
 */
export function handleGetTreasury(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("getTreasury");

  return async (ctx) => {
    log.info("getTreasury");
    const ppPublicKey = ctx.request.url.searchParams.get("ppPublicKey");
    if (!ppPublicKey) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = {
        message: "ppPublicKey query parameter is required",
      };
      return;
    }

    // Verify PP ownership
    const ownerPublicKey = (ctx.state.session as { sub: string }).sub;
    const pp = await ppRepo.findByPublicKeyAndOwner(
      ppPublicKey,
      ownerPublicKey,
    );
    if (!pp) {
      ctx.response.status = Status.NotFound;
      ctx.response.body = { message: "Provider not found" };
      return;
    }

    const horizonUrl = NETWORK_CONFIG.horizonUrl;
    if (!horizonUrl) {
      ctx.response.status = Status.ServiceUnavailable;
      ctx.response.body = { message: "No Horizon URL configured" };
      return;
    }

    try {
      const response = await fetch(`${horizonUrl}/accounts/${ppPublicKey}`);

      if (!response.ok) {
        throw new Error(`Horizon returned ${response.status}`);
      }

      const accountData = await response.json();

      ctx.response.status = Status.OK;
      ctx.response.body = {
        message: "Treasury info retrieved",
        data: {
          address: ppPublicKey,
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
