import { type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { PayTransactionRepository } from "@/persistence/drizzle/repository/pay-transaction.repository.ts";
import type { JwtSessionData } from "@/http/middleware/auth/index.ts";
import type { PayTransactionStatus } from "@/persistence/drizzle/entity/pay-transaction.entity.ts";

const txRepo = new PayTransactionRepository(drizzleClient);

export const listTransactionsHandler = async (ctx: Context) => {
  const session = ctx.state.session as JwtSessionData;
  const accountId = session.sub;

  const params = ctx.request.url.searchParams;
  const limit = Math.min(Number(params.get("limit") || "50"), 100);
  const offset = Number(params.get("offset") || "0");
  const status = params.get("status") as PayTransactionStatus | null;

  const transactions = await txRepo.findByAccountId(accountId, {
    limit,
    offset,
    status: status ?? undefined,
  });

  const total = await txRepo.countByAccountId(accountId);

  ctx.response.status = Status.OK;
  ctx.response.body = {
    message: "Transactions retrieved",
    data: {
      transactions: transactions.map((tx) => ({
        id: tx.id,
        type: tx.type.toLowerCase(),
        status: tx.status.toLowerCase(),
        amount: tx.amount.toString(),
        assetCode: tx.assetCode,
        from: tx.fromAddress,
        to: tx.toAddress,
        jurisdiction: {
          from: tx.jurisdictionFrom,
          to: tx.jurisdictionTo,
        },
        createdAt: tx.createdAt.toISOString(),
        updatedAt: tx.updatedAt.toISOString(),
      })),
      total,
    },
  };
};
