import { type Context, Status } from "@oak/oak";
import { StrKey } from "@colibri/core";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { PayTransactionRepository } from "@/persistence/drizzle/repository/pay-transaction.repository.ts";
import { PayKycRepository } from "@/persistence/drizzle/repository/pay-kyc.repository.ts";
import {
  PayTransactionStatus,
  PayTransactionType,
} from "@/persistence/drizzle/entity/pay-transaction.entity.ts";
import { PayKycStatus } from "@/persistence/drizzle/entity/pay-kyc.entity.ts";
import { createEscrow } from "@/core/service/pay/escrow.service.ts";
import type { JwtSessionData } from "@/http/middleware/auth/index.ts";

const txRepo = new PayTransactionRepository(drizzleClient);
const kycRepo = new PayKycRepository(drizzleClient);

/**
 * POST /pay/self/send
 *
 * Send from self-custodial wallet. Checks receiver KYC — if unverified,
 * creates an escrow record instead of direct UTXO transfer.
 */
export const postSelfSendHandler = async (ctx: Context) => {
  try {
    const body = await ctx.request.body.json();
    const { to, amount } = body;

    if (!to || !amount) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "to and amount are required" };
      return;
    }

    // Validate `to` is a valid Stellar public key
    if (typeof to !== "string" || !StrKey.isValidEd25519PublicKey(to)) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = {
        message: "to must be a valid Stellar public key (G...)",
      };
      return;
    }

    // Validate amount is a valid positive integer string
    if (typeof amount !== "string" || !/^\d+$/.test(amount)) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = {
        message: "amount must be a valid positive integer string",
      };
      return;
    }

    const sendAmount = BigInt(amount);
    if (sendAmount <= 0n) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "Amount must be positive" };
      return;
    }

    const session = ctx.state.session as JwtSessionData;

    // Reject custodial JWTs — this endpoint is for self-custodial (SEP-10) users only
    if (session.type === "custodial") {
      ctx.response.status = Status.Forbidden;
      ctx.response.body = {
        message: "This endpoint is for self-custodial users only",
      };
      return;
    }

    const accountId = session.sub;

    // Check receiver KYC status
    const receiverKyc = await kycRepo.findByAddress(to);
    const isVerified = receiverKyc?.status === PayKycStatus.VERIFIED;

    // Create transaction record
    const txId = crypto.randomUUID();
    await txRepo.create({
      id: txId,
      type: PayTransactionType.SEND,
      status: isVerified
        ? PayTransactionStatus.PENDING
        : PayTransactionStatus.COMPLETED,
      amount: sendAmount,
      assetCode: "XLM",
      fromAddress: accountId,
      toAddress: to,
      accountId,
      mode: "self",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    let escrowId: string | undefined;
    if (!isVerified) {
      // Receiver not KYC'd — create escrow
      escrowId = await createEscrow({
        senderAddress: accountId,
        receiverAddress: to,
        amount: sendAmount,
        mode: "self",
        bundleId: txId,
      });
    }

    // TODO: Build privacy operations and submit bundle to mempool

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: isVerified
        ? "Send initiated"
        : "Send initiated (held in escrow)",
      data: {
        bundleId: txId,
        status: isVerified ? "pending" : "escrowed",
        escrowId,
      },
    };
  } catch {
    ctx.response.status = Status.BadRequest;
    ctx.response.body = { message: "Invalid request body" };
  }
};
