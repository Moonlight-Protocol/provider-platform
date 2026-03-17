import { type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import {
  OperationsBundleRepository,
  TransactionRepository,
} from "@/persistence/drizzle/repository/index.ts";
import { BundleStatus } from "@/persistence/drizzle/entity/operations-bundle.entity.ts";
import { TransactionStatus } from "@/persistence/drizzle/entity/transaction.entity.ts";

const bundleRepo = new OperationsBundleRepository(drizzleClient);
const txRepo = new TransactionRepository();

/**
 * GET /dashboard/operations
 *
 * Returns bundle processing stats: counts by status, success/failure rates.
 * Uses COUNT(*) queries instead of loading all rows.
 */
export const getOperationsHandler = async (ctx: Context) => {
  const [pending, processing, completed, expired] = await Promise.all([
    bundleRepo.countByStatus(BundleStatus.PENDING),
    bundleRepo.countByStatus(BundleStatus.PROCESSING),
    bundleRepo.countByStatus(BundleStatus.COMPLETED),
    bundleRepo.countByStatus(BundleStatus.EXPIRED),
  ]);

  const [verified, failed, unverified] = await Promise.all([
    txRepo.countByStatus(TransactionStatus.VERIFIED),
    txRepo.countByStatus(TransactionStatus.FAILED),
    txRepo.countByStatus(TransactionStatus.UNVERIFIED),
  ]);

  const totalBundles = pending + processing + completed + expired;
  const totalTransactions = verified + failed + unverified;

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
};
