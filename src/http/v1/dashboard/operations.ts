import { type Context, Status } from "@oak/oak";
import { and, count, eq, isNull } from "drizzle-orm";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { operationsBundle } from "@/persistence/drizzle/entity/operations-bundle.entity.ts";
import { BundleStatus } from "@/persistence/drizzle/entity/operations-bundle.entity.ts";
import {
  transaction,
  TransactionStatus,
} from "@/persistence/drizzle/entity/transaction.entity.ts";
import { bundleTransaction } from "@/persistence/drizzle/entity/bundle-transaction.entity.ts";
import type { PaymentProvider } from "@/persistence/drizzle/entity/pp.entity.ts";
import type { Logger } from "@/utils/logger/index.ts";

/**
 * GET /api/v1/providers/:ppPublicKey/operations
 *
 * Returns bundle processing stats SCOPED to this PP: counts by status,
 * success/failure rates. Transaction counts are derived by joining bundles
 * through bundle_transactions to filter by ppPublicKey.
 */
export function handleGetOperations(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("getOperations");

  return async (ctx) => {
    log.info("getOperations");
    const pp = ctx.state.pp as PaymentProvider;

    log.event("counting bundle statuses for PP");
    const bundleCountByStatus = async (status: BundleStatus): Promise<number> =>
      (await drizzleClient
        .select({ value: count() })
        .from(operationsBundle)
        .where(
          and(
            eq(operationsBundle.ppPublicKey, pp.publicKey),
            eq(operationsBundle.status, status),
            isNull(operationsBundle.deletedAt),
          ),
        ))[0]?.value ?? 0;

    const [pending, processing, completed, expired] = await Promise.all([
      bundleCountByStatus(BundleStatus.PENDING),
      bundleCountByStatus(BundleStatus.PROCESSING),
      bundleCountByStatus(BundleStatus.COMPLETED),
      bundleCountByStatus(BundleStatus.EXPIRED),
    ]);

    log.event("counting transaction statuses for PP");
    const txCountByStatus = async (
      status: TransactionStatus,
    ): Promise<number> =>
      (await drizzleClient
        .select({ value: count() })
        .from(transaction)
        .innerJoin(
          bundleTransaction,
          eq(bundleTransaction.transactionId, transaction.id),
        )
        .innerJoin(
          operationsBundle,
          eq(operationsBundle.id, bundleTransaction.bundleId),
        )
        .where(
          and(
            eq(operationsBundle.ppPublicKey, pp.publicKey),
            eq(transaction.status, status),
            isNull(transaction.deletedAt),
          ),
        ))[0]?.value ?? 0;

    const [verified, failed, unverified] = await Promise.all([
      txCountByStatus(TransactionStatus.VERIFIED),
      txCountByStatus(TransactionStatus.FAILED),
      txCountByStatus(TransactionStatus.UNVERIFIED),
    ]);

    const totalBundles = pending + processing + completed + expired;
    const totalTransactions = verified + failed + unverified;
    log.debug("totalBundles", totalBundles);
    log.debug("totalTransactions", totalTransactions);

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Operations stats retrieved",
      data: {
        bundles: {
          total: totalBundles,
          pending,
          processing,
          completed,
          expired,
          successRate: totalBundles > 0
            ? ((completed / totalBundles) * 100).toFixed(1) + "%"
            : "N/A",
        },
        transactions: {
          total: totalTransactions,
          verified,
          failed,
          unverified,
          successRate: totalTransactions > 0
            ? ((verified / totalTransactions) * 100).toFixed(1) + "%"
            : "N/A",
        },
      },
    };
    log.event("operations response assembled");
  };
}
