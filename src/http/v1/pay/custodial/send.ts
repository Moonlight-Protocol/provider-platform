import { type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { PayTransactionRepository } from "@/persistence/drizzle/repository/pay-transaction.repository.ts";
import { PayCustodialAccountRepository } from "@/persistence/drizzle/repository/pay-custodial-account.repository.ts";
import { PayTransactionType, PayTransactionStatus } from "@/persistence/drizzle/entity/pay-transaction.entity.ts";
import type { JwtSessionData } from "@/http/middleware/auth/index.ts";

const txRepo = new PayTransactionRepository(drizzleClient);
const accountRepo = new PayCustodialAccountRepository(drizzleClient);

export const postCustodialSendHandler = async (ctx: Context) => {
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

    const account = await accountRepo.findById(accountId);
    if (!account) {
      ctx.response.status = Status.NotFound;
      ctx.response.body = { message: "Account not found" };
      return;
    }

    const sendAmount = BigInt(amount);
    if (sendAmount <= 0n) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "Amount must be positive" };
      return;
    }

    if (account.balance < sendAmount) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "Insufficient balance" };
      return;
    }

    // Debit balance
    await accountRepo.update(accountId, {
      balance: account.balance - sendAmount,
      updatedAt: new Date(),
    });

    // Create transaction record
    const txId = crypto.randomUUID();
    await txRepo.create({
      id: txId,
      type: PayTransactionType.SEND,
      status: PayTransactionStatus.PENDING,
      amount: sendAmount,
      assetCode: "XLM",
      fromAddress: account.depositAddress,
      toAddress: to,
      accountId,
      mode: "custodial",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // TODO: Build privacy bundle and submit to mempool

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
