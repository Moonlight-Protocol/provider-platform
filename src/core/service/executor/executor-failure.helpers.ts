import type { Logger } from "@/utils/logger/index.ts";
import { BundleStatus } from "@/persistence/drizzle/entity/operations-bundle.entity.ts";
import type { OperationsBundleRepository } from "@/persistence/drizzle/repository/operations-bundle.repository.ts";
import type { SlotBundle } from "@/core/service/bundle/bundle.types.ts";
import { withSpan } from "@/core/tracing.ts";

export type ExecutionFailureResult = {
  bundleId: string;
  nextRetryCount: number;
  lastFailureReason: string;
};

/**
 * Handles execution failure: increments retryCount, moves bundle to PENDING
 * (below max retries) or FAILED / dead-letter (at max). Returns the subset of
 * bundles that are still eligible for retry so the caller can re-queue them.
 */
export function handleExecutionFailure(
  error: Error,
  bundleIds: string[],
  lastFailureReason: string,
  deps: {
    operationsBundleRepository: OperationsBundleRepository;
    maxRetryAttempts: number;
    log: Logger;
  },
): Promise<ExecutionFailureResult[]> {
  return withSpan("Executor.handleExecutionFailure", async (span) => {
    const log = deps.log.scope("handleExecutionFailure");
    log.info("handleExecutionFailure");
    log.debug("bundleIdCount", bundleIds.length);
    log.debug("lastFailureReason", lastFailureReason);

    const errorMessage = error.message || "Unknown error";
    span.addEvent("handling_failure", {
      "error.message": errorMessage,
      "bundles.count": bundleIds.length,
    });
    log.error(error, "execution failed");

    const bundlesToRetry: ExecutionFailureResult[] = [];

    for (const bundleId of bundleIds) {
      try {
        const bundle = await deps.operationsBundleRepository.findById(bundleId);
        if (!bundle) {
          log.debug("bundleId", bundleId);
          log.event("bundle not found while handling execution failure");
          continue;
        }

        const nextRetryCount = (bundle.retryCount ?? 0) + 1;
        const hasReachedMaxAttempts = nextRetryCount >= deps.maxRetryAttempts;

        if (hasReachedMaxAttempts) {
          await deps.operationsBundleRepository.update(bundleId, {
            status: BundleStatus.FAILED,
            retryCount: nextRetryCount,
            lastFailureReason,
            updatedAt: new Date(),
          });
          log.debug("bundleId", bundleId);
          log.debug("retryCount", nextRetryCount);
          log.event("bundle moved to dead-letter after max retry attempts");
        } else {
          await deps.operationsBundleRepository.update(bundleId, {
            status: BundleStatus.PENDING,
            retryCount: nextRetryCount,
            lastFailureReason,
            updatedAt: new Date(),
          });
          span.addEvent("bundle_reset_to_pending", { "bundle.id": bundleId });

          bundlesToRetry.push({ bundleId, nextRetryCount, lastFailureReason });
        }
      } catch (updateError) {
        span.addEvent("bundle_reset_failed", { "bundle.id": bundleId });
        log.debug("bundleId", bundleId);
        log.error(updateError, "failed to update bundle status");
      }
    }

    return bundlesToRetry;
  });
}

/**
 * Enriches in-memory SlotBundle objects with the updated retry metadata
 * returned from handleExecutionFailure, then filters to the eligible subset.
 */
export function buildRetryBundles(
  slot: { getBundles(): SlotBundle[] },
  metaList: ExecutionFailureResult[],
  deps: { log: Logger },
): SlotBundle[] {
  const log = deps.log.scope("buildRetryBundles");
  log.info("buildRetryBundles");
  log.debug("metaCount", metaList.length);

  const metaByBundleId = new Map(metaList.map((m) => [m.bundleId, m] as const));

  const eligible = slot.getBundles().filter((b) =>
    metaByBundleId.has(b.bundleId)
  );

  for (const bundle of eligible) {
    const meta = metaByBundleId.get(bundle.bundleId);
    if (!meta) continue;
    bundle.retryCount = meta.nextRetryCount;
    bundle.lastFailureReason = meta.lastFailureReason;
  }

  log.debug("eligibleCount", eligible.length);
  return eligible;
}
