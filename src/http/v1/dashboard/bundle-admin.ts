import { type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { OperationsBundleRepository } from "@/persistence/drizzle/repository/index.ts";
import { BundleStatus } from "@/persistence/drizzle/entity/operations-bundle.entity.ts";
import { getMempool } from "@/core/mempool/index.ts";
import { LOG } from "@/config/logger.ts";

const bundleRepo = new OperationsBundleRepository(drizzleClient);

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
 * When `olderThanMs` matches more than 10 000 bundles the response includes
 * `truncated: true`; callers should repeat the request until truncated is false.
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
  let ageExpiredIds: string[] = [];
  let truncated = false;

  // 1. Age-filter path: single atomic UPDATE via expireOlderThan (no pre-read, no TOCTOU)
  if (hasAgeFilter) {
    const cutoff = new Date(Date.now() - olderThanMs!);
    ageExpiredIds = await bundleRepo.expireOlderThan(cutoff, ACTIVE_STATUSES, AGE_FILTER_LIMIT);

    if (ageExpiredIds.length > 0) {
      getMempool().purgeBundles(ageExpiredIds);
    }

    if (ageExpiredIds.length >= AGE_FILTER_LIMIT) {
      truncated = true;
    }
  }

  // 2. Explicit-IDs path: DB-first, then mempool-purge (same ordering as age-filter path)
  let idExpiredIds: string[] = [];
  if (hasIdFilter) {
    const remainingIds = ageExpiredIds.length > 0
      ? bundleIds!.filter((id) => !new Set(ageExpiredIds).has(id))
      : bundleIds!;

    if (remainingIds.length > 0) {
      idExpiredIds = await bundleRepo.expireByIds(remainingIds, ACTIVE_STATUSES);
      if (idExpiredIds.length > 0) {
        getMempool().purgeBundles(idExpiredIds);
      }

      const skipped = remainingIds.length - idExpiredIds.length;
      if (skipped > 0) {
        LOG.warn(`Admin expire: ${skipped} bundle(s) from bundleIds were not active and were skipped`);
      }
    }
  }

  const totalExpired = ageExpiredIds.length + idExpiredIds.length;

  LOG.info(
    `Admin expire: expired ${totalExpired} bundle(s) (age: ${ageExpiredIds.length}, ids: ${idExpiredIds.length})${truncated ? " [truncated]" : ""}`,
  );

  ctx.response.status = Status.OK;
  ctx.response.body = {
    message: `Expired ${totalExpired} bundle(s)`,
    data: { expired: totalExpired, truncated },
  };
};
