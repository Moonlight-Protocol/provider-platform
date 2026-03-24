import { type Context, Status } from "@oak/oak";
import { eq } from "drizzle-orm";
import { StrKey } from "@colibri/core";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { PayKycRepository } from "@/persistence/drizzle/repository/pay-kyc.repository.ts";
import { payCustodialAccount, PayCustodialStatus } from "@/persistence/drizzle/entity/pay-custodial-account.entity.ts";
import { payTransaction, PayTransactionType, PayTransactionStatus } from "@/persistence/drizzle/entity/pay-transaction.entity.ts";
import { PayKycStatus } from "@/persistence/drizzle/entity/pay-kyc.entity.ts";
import { createEscrow } from "@/core/service/pay/escrow.service.ts";
import type { JwtSessionData } from "@/http/middleware/auth/index.ts";

const kycRepo = new PayKycRepository(drizzleClient);

export const postCustodialSendHandler = async (ctx: Context) => {
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
      ctx.response.body = { message: "to must be a valid Stellar public key (G...)" };
      return;
    }

    // Validate amount is a valid positive integer string
    if (typeof amount !== "string" || !/^\d+$/.test(amount)) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "amount must be a valid positive integer string" };
      return;
    }

    const sendAmount = BigInt(amount);
    if (sendAmount <= 0n) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "Amount must be positive" };
      return;
    }

    const session = ctx.state.session as JwtSessionData;

    // Verify this is a custodial JWT
    if (session.type !== "custodial") {
      ctx.response.status = Status.Forbidden;
      ctx.response.body = { message: "Custodial authentication required" };
      return;
    }

    const accountId = session.sub;

    // Check receiver KYC before entering transaction (read doesn't need the lock,
    // and using the module-level kycRepo inside a drizzleClient.transaction()
    // uses a separate connection — not part of the transaction)
    const receiverKyc = await kycRepo.findByAddress(to);
    const receiverIsVerified = receiverKyc?.status === PayKycStatus.VERIFIED;

    // Atomic balance debit within a DB transaction with row-level locking
    const result = await drizzleClient.transaction(async (tx) => {
      // SELECT with FOR UPDATE to lock the row
      const [account] = await tx
        .select()
        .from(payCustodialAccount)
        .where(eq(payCustodialAccount.id, accountId))
        .for("update");

      if (!account) {
        return { error: "Account not found", status: Status.NotFound } as const;
      }

      if (account.status === PayCustodialStatus.SUSPENDED) {
        return { error: "Account suspended", status: Status.Forbidden } as const;
      }

      if (account.balance < sendAmount) {
        return { error: "Insufficient balance", status: Status.BadRequest } as const;
      }

      // Debit balance atomically
      await tx
        .update(payCustodialAccount)
        .set({
          balance: account.balance - sendAmount,
          updatedAt: new Date(),
        })
        .where(eq(payCustodialAccount.id, accountId));

      // Create transaction record (within the same DB transaction)
      const txId = crypto.randomUUID();
      await tx.insert(payTransaction).values({
        id: txId,
        type: PayTransactionType.SEND,
        status: receiverIsVerified ? PayTransactionStatus.PENDING : PayTransactionStatus.COMPLETED,
        amount: sendAmount,
        assetCode: "XLM",
        fromAddress: account.depositAddress,
        toAddress: to,
        accountId,
        mode: "custodial",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      return { txId, isVerified: receiverIsVerified, depositAddress: account.depositAddress } as const;
    });

    if ("error" in result) {
      ctx.response.status = result.status!;
      ctx.response.body = { message: result.error };
      return;
    }

    const { txId, isVerified, depositAddress } = result;

    let escrowId: string | undefined;
    if (!isVerified) {
      escrowId = await createEscrow({
        senderAddress: depositAddress,
        receiverAddress: to,
        amount: sendAmount,
        mode: "custodial",
        bundleId: txId,
      });
    }

    // TODO: Build privacy bundle and submit to mempool

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: isVerified ? "Send initiated" : "Send initiated (held in escrow)",
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
