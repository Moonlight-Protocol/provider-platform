import { type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { OperationsBundleRepository } from "@/persistence/drizzle/repository/index.ts";
import { BundleStatus } from "@/persistence/drizzle/entity/operations-bundle.entity.ts";
import { getMempool } from "@/core/mempool/index.ts";
import { LOG } from "@/config/logger.ts";

let testBundleRepoOverride: OperationsBundleRepository | null = null;

function getBundleRepo(): OperationsBundleRepository {
  return testBundleRepoOverride ?? new OperationsBundleRepository(drizzleClient);
}

/**
 * Test-only hook to override repository wiring in integration tests.
 */
export function setBundleRepoForTests(repo: OperationsBundleRepository | null) {
  testBundleRepoOverride = repo;
}

const ACTIVE_STATUSES = [BundleStatus.PENDING, BundleStatus.PROCESSING];

/** Maximum number of explicit bundle IDs accepted per request. */
const MAX_EXPIRE_IDS = 200;

/**
 * POST /dashboard/bundles/expire
 *
 * Manually expires PENDING/PROCESSING bundles and evicts them from the in-memory mempool.
 * Accepts at least one of:
 *   - olderThanMs: expire bundles created more than N milliseconds ago
 *   - bundleIds:   expire a specific list of bundle IDs (max 200)
 *
 * The age-filter path processes records in 10k batches until completion.
 */
export const postExpireBundlesHandler = async (ctx: Context) => {
  let body: { olderThanMs?: number; bundleIds?: string[] };
  try {
    const raw = await ctx.request.body.json();
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "Body must be a JSON object" };
      return;
    }
    body = raw;
  } catch {
    ctx.response.status = Status.BadRequest;
    ctx.response.body = { message: "Invalid JSON body" };
    return;
  }

  const { olderThanMs, bundleIds } = body;

  const hasAgeFilter = typeof olderThanMs === "number" && Number.isFinite(olderThanMs) && olderThanMs > 0;
  const hasIdFilter = Array.isArray(bundleIds) && bundleIds.length > 0;

  if (!hasAgeFilter && !hasIdFilter) {
    ctx.response.status = Status.BadRequest;
    ctx.response.body = {
      message: "Provide at least one of: olderThanMs (positive number) or bundleIds (non-empty array)",
    };
    return;
  }

  if (hasIdFilter && !bundleIds!.every((id) => typeof id === "string" && id.length > 0)) {
    ctx.response.status = Status.BadRequest;
    ctx.response.body = { message: "All bundleIds must be non-empty strings" };
    return;
  }

  if (hasIdFilter && bundleIds!.length > MAX_EXPIRE_IDS) {
    ctx.response.status = Status.BadRequest;
    ctx.response.body = {
      message: `bundleIds may contain at most ${MAX_EXPIRE_IDS} entries, got ${bundleIds!.length}`,
    };
    return;
  }

  const AGE_FILTER_LIMIT = 10_000;
  let ageExpiredCount = 0;

  // 1. Age-filter path: bounded atomic UPDATE batches until done
  if (hasAgeFilter) {
    const cutoff = new Date(Date.now() - olderThanMs!);
    let batch: string[] = [];
    do {
      batch = await getBundleRepo().expireOlderThan(cutoff, ACTIVE_STATUSES, AGE_FILTER_LIMIT);
      ageExpiredCount += batch.length;
      if (batch.length > 0) {
        getMempool().purgeBundles(batch);
      }
    } while (batch.length >= AGE_FILTER_LIMIT);
  }

  // 2. Explicit-IDs path: DB-first, then mempool-purge.
  // expireByIds filters by ACTIVE_STATUSES, so IDs already expired by the age path are safe
  // no-ops — no deduplication needed here.
  let idExpiredCount = 0;
  if (hasIdFilter) {
    const idExpiredIds = await getBundleRepo().expireByIds(bundleIds!, ACTIVE_STATUSES);
    idExpiredCount = idExpiredIds.length;
    if (idExpiredCount > 0) {
      getMempool().purgeBundles(idExpiredIds);
    }

    const skipped = bundleIds!.length - idExpiredCount;
    if (skipped > 0) {
      LOG.warn(`Admin expire: ${skipped} bundle(s) from bundleIds were not active and were skipped`);
    }
  }

  const totalExpired = ageExpiredCount + idExpiredCount;

  LOG.info(
    `Admin expire: expired ${totalExpired} bundle(s) (age: ${ageExpiredCount}, ids: ${idExpiredCount})`,
  );

  ctx.response.status = Status.OK;
  ctx.response.body = {
    message: `Expired ${totalExpired} bundle(s)`,
    data: { expired: totalExpired, truncated: false },
  };
};
