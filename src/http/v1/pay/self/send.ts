import { type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { PayTransactionRepository } from "@/persistence/drizzle/repository/pay-transaction.repository.ts";
import { PayTransactionType, PayTransactionStatus } from "@/persistence/drizzle/entity/pay-transaction.entity.ts";
import type { JwtSessionData } from "@/http/middleware/auth/index.ts";

const txRepo = new PayTransactionRepository(drizzleClient);

/**
 * POST /pay/self/send
 *
 * Send from self-custodial wallet.
 * TODO: Build privacy bundle via SDK + submit to mempool.
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

    const session = ctx.state.session as JwtSessionData;
    const accountId = session.sub;

    // Create transaction record
    const txId = crypto.randomUUID();
    await txRepo.create({
      id: txId,
      type: PayTransactionType.SEND,
      status: PayTransactionStatus.PENDING,
      amount: BigInt(amount),
      assetCode: "XLM",
      fromAddress: accountId,
      toAddress: to,
      accountId,
      mode: "self",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // TODO: Build privacy operations and submit bundle
    // For now, return pending status

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Send initiated",
      data: {
        bundleId: txId,
        status: "pending",
      },
    };
  } catch {
    ctx.response.status = Status.BadRequest;
    ctx.response.body = { message: "Invalid request body" };
  }
};
