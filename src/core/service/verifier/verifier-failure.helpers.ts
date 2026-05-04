import { LOG } from "@/config/logger.ts";
import { BundleStatus } from "@/persistence/drizzle/entity/operations-bundle.entity.ts";
import { TransactionStatus } from "@/persistence/drizzle/entity/transaction.entity.ts";
import type { OperationsBundle } from "@/persistence/drizzle/entity/operations-bundle.entity.ts";
import type { OperationsBundleRepository } from "@/persistence/drizzle/repository/operations-bundle.repository.ts";
import type { SlotBundle } from "@/core/service/bundle/bundle.types.ts";
import { safeJsonStringify } from "@/utils/parse/safeStringify.ts";

export type VerifierFailureDeps = {
  operationsBundleRepository: OperationsBundleRepository;
  updateTxStatus: (txId: string, status: TransactionStatus) => Promise<void>;
  createSlotBundleFn: (bundle: OperationsBundle) => Promise<SlotBundle>;
  reAddBundlesFn: (bundles: SlotBundle[]) => Promise<void>;
  maxRetryAttempts: number;
};

/**
 * Handles verification failure: marks the transaction FAILED, increments
 * retryCount on each bundle, dead-letters those that reached the max, and
 * re-queues the rest into the mempool.
 *
 * Extracted as a pure (dependency-injected) function so it can be tested
 * without importing env.ts or the mempool singletons.
 */
export async function handleVerificationFailure(
  txId: string,
  reason: string,
  bundleIds: string[],
  deps: VerifierFailureDeps,
): Promise<void> {
  LOG.warn("Transaction verification failed", { txId, reason, bundleIds });

  await deps.updateTxStatus(txId, TransactionStatus.FAILED);

  const retryableBundleIds: string[] = [];

  for (const bundleId of bundleIds) {
    try {
      const bundle = await deps.operationsBundleRepository.findById(bundleId);
      if (!bundle) {
        LOG.warn(
          `Bundle ${bundleId} not found while handling verification failure`,
        );
        continue;
      }

      const nextRetryCount = (bundle.retryCount ?? 0) + 1;
      const hasReachedMaxAttempts = nextRetryCount >= deps.maxRetryAttempts;

      const lastFailureReason = safeJsonStringify({
        occurredAt: new Date().toISOString(),
        phase: "verification",
        error: { message: reason },
        txId,
        bundleId,
      }) ?? reason;

      await deps.operationsBundleRepository.update(bundleId, {
        status: hasReachedMaxAttempts
          ? BundleStatus.FAILED
          : BundleStatus.PENDING,
        retryCount: nextRetryCount,
        lastFailureReason,
        updatedAt: new Date(),
      });

      if (!hasReachedMaxAttempts) {
        retryableBundleIds.push(bundleId);
      } else {
        LOG.warn(
          "Bundle moved to dead-letter after max verification retry attempts reached",
          {
            bundleId,
            retryCount: nextRetryCount,
          },
        );
      }
    } catch (error) {
      LOG.error(`Failed to update bundle ${bundleId} status`, { error });
    }
  }

  if (retryableBundleIds.length === 0) return;

  const slotBundles = (
    await Promise.all(
      retryableBundleIds.map(async (bundleId) => {
        try {
          const updated = await deps.operationsBundleRepository.findById(
            bundleId,
          );
          if (!updated) return null;
          return await deps.createSlotBundleFn(updated);
        } catch (error) {
          LOG.error(
            `Failed to build SlotBundle for retry of bundle ${bundleId}`,
            { error },
          );
          return null;
        }
      }),
    )
  ).filter((b): b is NonNullable<typeof b> => b !== null);

  if (slotBundles.length > 0) {
    await deps.reAddBundlesFn(slotBundles);
    LOG.info("Bundles re-added to mempool after verification failure", {
      bundleIds: slotBundles.map((b) => b.bundleId),
    });
  }
}
