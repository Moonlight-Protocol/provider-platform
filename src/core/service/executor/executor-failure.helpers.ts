import { LOG } from "@/config/logger.ts";
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
  },
): Promise<ExecutionFailureResult[]> {
  return withSpan("Executor.handleExecutionFailure", async (span) => {
    const errorMessage = error.message || "Unknown error";
    span.addEvent("handling_failure", {
      "error.message": errorMessage,
      "bundles.count": bundleIds.length,
    });
    LOG.error("Execution failed", { error: errorMessage, bundleIds });

    const bundlesToRetry: ExecutionFailureResult[] = [];

    for (const bundleId of bundleIds) {
      try {
        const bundle = await deps.operationsBundleRepository.findById(bundleId);
        if (!bundle) {
          LOG.warn(
            `Bundle ${bundleId} not found while handling execution failure`,
          );
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
          LOG.warn(
            "Bundle moved to dead-letter after max retry attempts reached",
            {
              bundleId,
              retryCount: nextRetryCount,
            },
          );
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
        LOG.error(`Failed to update bundle ${bundleId} status`, {
          error: updateError,
        });
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
): SlotBundle[] {
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

  return eligible;
}
