import { type Context, Status } from "@oak/oak";
import { Buffer } from "buffer";
import type { JwtSessionData } from "@/http/middleware/auth/index.ts";
import {
  MAX_UTXO_SLOTS,
  queryBalances,
} from "@/core/service/pay/channel.service.ts";
import { resolveChannelContext } from "@/core/service/executor/channel-resolver.ts";
import { LOG } from "@/config/logger.ts";

/**
 * POST /pay/self/balance
 *
 * Queries on-chain UTXO balances for the authenticated self-custodial user.
 * Accepts hex-encoded P256 public keys and returns per-UTXO and total balances.
 *
 * Body: { publicKeys: string[] }  — hex-encoded P256 public keys
 * Response: {
 *   totalBalance: string,
 *   utxoCount: number,
 *   freeSlots: number,
 *   utxos: Array<{ publicKey: string, balance: string }>
 * }
 */
export const postSelfBalanceHandler = async (ctx: Context) => {
  const session = ctx.state.session as JwtSessionData;

  // Reject custodial JWTs — this endpoint is for self-custodial (SEP-10) users only
  if (session.type === "custodial") {
    ctx.response.status = Status.Forbidden;
    ctx.response.body = {
      message: "This endpoint is for self-custodial users only",
    };
    return;
  }

  const _accountId = session.sub;

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

    // Convert hex-encoded public keys to Uint8Array
    const utxoPublicKeys: Uint8Array[] = publicKeys.map(
      (hexKey: string) => new Uint8Array(Buffer.from(hexKey, "hex")),
    );

    const channelCtx = await resolveChannelContext(channelContractId);
    const balances = await queryBalances(
      utxoPublicKeys,
      channelCtx.channelClient,
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
  } catch (error) {
    LOG.warn("Self balance query failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to query balance" };
  }
};
