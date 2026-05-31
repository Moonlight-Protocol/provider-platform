import { type Context, Status } from "@oak/oak";
import { Buffer } from "buffer";
import type { JwtSessionData } from "@/http/middleware/auth/index.ts";
import {
  MAX_UTXO_SLOTS,
  queryBalances,
} from "@/core/service/pay/channel.service.ts";
import { resolveChannelClient } from "@/core/service/executor/channel-resolver.ts";
import type { Logger } from "@/utils/logger/index.ts";

/**
 * POST /pay/self/balance
 *
 * Queries on-chain UTXO balances for the authenticated self-custodial user.
 * Accepts hex-encoded P256 public keys and returns per-UTXO and total balances.
 *
 * Body: { publicKeys: string[], channelContractId: string }
 * Response: {
 *   totalBalance: string,
 *   utxoCount: number,
 *   freeSlots: number,
 *   utxos: Array<{ publicKey: string, balance: string }>
 * }
 */
export function handlePostSelfBalance(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("postSelfBalance");

  return async (ctx) => {
    log.info("postSelfBalance");
    const session = ctx.state.session as JwtSessionData;

    if (session.type === "custodial") {
      ctx.response.status = Status.Forbidden;
      ctx.response.body = {
        message: "This endpoint is for self-custodial users only",
      };
      return;
    }

    try {
      const body = await ctx.request.body.json();
      const { publicKeys, channelContractId } = body;

      if (!channelContractId || typeof channelContractId !== "string") {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = { message: "channelContractId is required" };
        return;
      }

      if (!Array.isArray(publicKeys) || publicKeys.length === 0) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = {
          message: "publicKeys must be a non-empty array of hex strings",
        };
        return;
      }

      if (publicKeys.length > MAX_UTXO_SLOTS) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = {
          message: `publicKeys array exceeds maximum of ${MAX_UTXO_SLOTS}`,
        };
        return;
      }

      log.debug("channelContractId", channelContractId);
      log.debug("utxoCount", publicKeys.length);

      const utxoPublicKeys: Uint8Array[] = publicKeys.map(
        (hexKey: string) => new Uint8Array(Buffer.from(hexKey, "hex")),
      );

      log.event("resolving read-only channel client");
      const { channelClient } = await resolveChannelClient(
        channelContractId,
        deps,
      );
      log.event("querying balances");
      const balances = await queryBalances(
        utxoPublicKeys,
        channelClient,
        deps,
      );

      const totalBalance = balances.reduce((sum, b) => sum + b, 0n);
      const utxoCount = balances.filter((b) => b > 0n).length;

      const utxos = publicKeys.map((pk: string, i: number) => ({
        publicKey: pk,
        balance: balances[i].toString(),
      }));

      ctx.response.status = Status.OK;
      ctx.response.body = {
        message: "Balance retrieved",
        data: {
          totalBalance: totalBalance.toString(),
          utxoCount,
          freeSlots: Math.max(0, MAX_UTXO_SLOTS - publicKeys.length),
          utxos,
        },
      };
      log.event("balance response assembled");
    } catch (error) {
      log.error(error, "self balance query failed");
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { message: "Failed to query balance" };
    }
  };
}
