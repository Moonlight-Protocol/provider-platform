import type { Logger } from "@/utils/logger/index.ts";
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
  log: Logger;
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
  const log = deps.log.scope("handleVerificationFailure");
  log.info("handleVerificationFailure");
  log.debug("txId", txId);
  log.debug("reason", reason);
  log.debug("bundleIdCount", bundleIds.length);
  log.event("transaction verification failed");

  log.event("marking transaction FAILED");
  await deps.updateTxStatus(txId, TransactionStatus.FAILED);

  const retryableBundleIds: string[] = [];

  for (const bundleId of bundleIds) {
    try {
      const bundle = await deps.operationsBundleRepository.findById(bundleId);
      if (!bundle) {
        log.debug("bundleId", bundleId);
        log.event("bundle not found while handling verification failure");
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
        log.debug("bundleId", bundleId);
        log.debug("retryCount", nextRetryCount);
        log.event(
          "bundle moved to dead-letter after max verification retry attempts reached",
        );
      }
    } catch (error) {
      log.debug("bundleId", bundleId);
      log.error(error, "failed to update bundle status");
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
          log.debug("bundleId", bundleId);
          log.error(error, "failed to build SlotBundle for retry");
          return null;
        }
      }),
    )
  ).filter((b): b is NonNullable<typeof b> => b !== null);

  if (slotBundles.length > 0) {
    await deps.reAddBundlesFn(slotBundles);
    log.debug("bundleIds", slotBundles.map((b) => b.bundleId));
    log.event("bundles re-added to mempool after verification failure");
  }
}
