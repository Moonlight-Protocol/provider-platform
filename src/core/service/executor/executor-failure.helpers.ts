import type { Logger } from "@/utils/logger/index.ts";
import { BundleStatus } from "@/persistence/drizzle/entity/operations-bundle.entity.ts";
import type { OperationsBundleRepository } from "@/persistence/drizzle/repository/operations-bundle.repository.ts";
import type { SlotBundle } from "@/core/service/bundle/bundle.types.ts";
import { currentTraceId, withSpan } from "@/core/tracing.ts";
import type { StructuredFailureDetail } from "@/core/service/executor/failure-detail.ts";

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
    /** True for an on-chain revert that will fail identically on retry. */
    deterministic: boolean;
    /** Structured identity persisted to `failureDetail` on terminal failure. */
    failureDetail: StructuredFailureDetail;
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
      deterministic: deps.deterministic,
      "failure.code": deps.failureDetail.code,
    });
    log.error(error, "execution failed", {
      bundleId: bundleIds,
      failureCode: deps.failureDetail.code,
      deterministic: deps.deterministic,
      traceId: currentTraceId(),
    });

    const failureDetail = { ...deps.failureDetail };
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
        // A deterministic revert is terminal immediately — retrying it only
        // wastes submits and produces duplicate FAILED traces (#12).
        const hasReachedMaxAttempts = nextRetryCount >= deps.maxRetryAttempts;
        const isTerminal = deps.deterministic || hasReachedMaxAttempts;

        if (isTerminal) {
          // Status-gated: a bundle concurrently moved to a terminal state
          // (e.g. EXPIRED by the TTL sweep while the slot was in flight)
          // must keep that state — never overwrite it with FAILED.
          const updated = await deps.operationsBundleRepository
            .updateIfStatusIn(bundleId, {
              status: BundleStatus.FAILED,
              retryCount: nextRetryCount,
              lastFailureReason,
              failureDetail,
            }, [BundleStatus.PENDING, BundleStatus.PROCESSING]);
          if (!updated) {
            span.addEvent("bundle_already_terminal", { "bundle.id": bundleId });
            log.debug("bundleId", bundleId);
            log.event(
              "bundle already in a terminal status, leaving it untouched",
            );
            continue;
          }
          log.debug("bundleId", bundleId);
          log.debug("retryCount", nextRetryCount);
          span.addEvent("bundle_failed_terminal", {
            "bundle.id": bundleId,
            reason: deps.deterministic ? "deterministic" : "max_retries",
          });
          log.event(
            deps.deterministic
              ? "bundle FAILED — deterministic revert, no retry"
              : "bundle moved to dead-letter after max retry attempts",
          );
        } else {
          const updated = await deps.operationsBundleRepository
            .updateIfStatusIn(bundleId, {
              status: BundleStatus.PENDING,
              retryCount: nextRetryCount,
              lastFailureReason,
            }, [BundleStatus.PENDING, BundleStatus.PROCESSING]);
          if (!updated) {
            span.addEvent("bundle_already_terminal", { "bundle.id": bundleId });
            log.debug("bundleId", bundleId);
            log.event(
              "bundle already in a terminal status, not eligible for retry",
            );
            continue;
          }
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

/**
 * TTL enforcement at the execution gate: removes every expired bundle from a
 * slot the executor just pulled, marking each EXPIRED (status-gated, so a
 * bundle already terminal keeps its state). Purely in-memory — the TTL is
 * derived from the bundle's own signatures at admission, so no chain or
 * database read is needed to know it. The periodic `expireBundles` sweep
 * only covers bundles still queued in the mempool; a pulled slot is outside
 * its reach, so without this check a bundle could execute past its TTL.
 */
export async function expireSlotBundlesPastTtl(
  slot: { getBundles(): SlotBundle[]; removeBundle(bundleId: string): boolean },
  deps: {
    operationsBundleRepository: OperationsBundleRepository;
    isExpired: (bundle: SlotBundle) => boolean;
    /** Emits the mempool.bundle_expired event; errors must not propagate. */
    emitExpired: (bundle: SlotBundle) => Promise<void>;
    log: Logger;
  },
): Promise<SlotBundle[]> {
  const log = deps.log.scope("expireSlotBundlesPastTtl");
  const expired = slot.getBundles().filter(deps.isExpired);

  for (const bundle of expired) {
    slot.removeBundle(bundle.bundleId);
    try {
      await deps.operationsBundleRepository.updateStatusIfActive(
        bundle.bundleId,
        BundleStatus.EXPIRED,
        [BundleStatus.PENDING, BundleStatus.PROCESSING],
      );
      log.debug("bundleId", bundle.bundleId);
      log.event("expired bundle evicted from slot before execution");
      await deps.emitExpired(bundle);
    } catch (error) {
      log.debug("bundleId", bundle.bundleId);
      log.error(error, "failed to persist EXPIRED for evicted bundle");
    }
  }

  return expired;
}
