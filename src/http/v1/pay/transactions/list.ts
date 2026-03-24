import { type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { PayTransactionRepository } from "@/persistence/drizzle/repository/pay-transaction.repository.ts";
import type { JwtSessionData } from "@/http/middleware/auth/index.ts";
import { PayTransactionStatus } from "@/persistence/drizzle/entity/pay-transaction.entity.ts";
import { LOG } from "@/config/logger.ts";

const txRepo = new PayTransactionRepository(drizzleClient);

const validStatuses = new Set<string>(Object.values(PayTransactionStatus));

export const listTransactionsHandler = async (ctx: Context) => {
  try {
    const session = ctx.state.session as JwtSessionData;
    const accountId = session.sub;

    const params = ctx.request.url.searchParams;
    const limit = Math.min(Number(params.get("limit") || "50"), 100);
    const offset = Number(params.get("offset") || "0");
    const statusParam = params.get("status");

    // Validate status parameter against actual enum values
    if (statusParam && !validStatuses.has(statusParam)) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = {
        message: `Invalid status. Must be one of: ${[...validStatuses].join(", ")}`,
      };
      return;
    }

    const status = statusParam as PayTransactionStatus | null;

    const transactions = await txRepo.findByAccountId(accountId, {
      limit,
      offset,
      status: status ?? undefined,
    });

    const total = await txRepo.countByAccountId(accountId, {
      status: status ?? undefined,
    });

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
  } catch (error) {
    LOG.warn("List transactions failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to retrieve transactions" };
  }
};
