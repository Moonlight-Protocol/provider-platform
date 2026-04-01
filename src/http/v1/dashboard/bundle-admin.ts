import { type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { OperationsBundleRepository } from "@/persistence/drizzle/repository/index.ts";
import { BundleStatus } from "@/persistence/drizzle/entity/operations-bundle.entity.ts";
import { getMempool } from "@/core/mempool/index.ts";
import { LOG } from "@/config/logger.ts";

const bundleRepo = new OperationsBundleRepository(drizzleClient);

const ACTIVE_STATUSES = [BundleStatus.PENDING, BundleStatus.PROCESSING];

/**
 * POST /dashboard/bundles/expire
 *
 * Manually expires PENDING/PROCESSING bundles and evicts them from the in-memory mempool.
 * Accepts at least one of:
 *   - olderThanMs: expire bundles created more than N milliseconds ago
 *   - bundleIds:   expire a specific list of bundle IDs
 */
export const postExpireBundlesHandler = async (ctx: Context) => {
  let body: { olderThanMs?: number; bundleIds?: string[] };
  try {
    const raw = await ctx.request.body.json();
    body = raw ?? {};
  } catch {
    ctx.response.status = Status.BadRequest;
    ctx.response.body = { message: "Invalid JSON body" };
    return;
  }

  const { olderThanMs, bundleIds } = body;

  const hasAgeFilter = typeof olderThanMs === "number" && olderThanMs > 0;
  const hasIdFilter = Array.isArray(bundleIds) && bundleIds.length > 0;

  if (!hasAgeFilter && !hasIdFilter) {
    ctx.response.status = Status.BadRequest;
    ctx.response.body = {
      message: "Provide at least one of: olderThanMs (positive number) or bundleIds (non-empty array)",
    };
    return;
  }

  const toExpireIds = new Set<string>();
  const now = new Date();

  // 1. Collect IDs older than the given age threshold
  if (hasAgeFilter) {
    const cutoff = new Date(Date.now() - olderThanMs!);
    const stale = await bundleRepo.findByStatusAndDateRange(
      BundleStatus.PENDING,
      undefined,
      cutoff,
    );
    const staleProcessing = await bundleRepo.findByStatusAndDateRange(
      BundleStatus.PROCESSING,
      undefined,
      cutoff,
    );
    for (const b of [...stale, ...staleProcessing]) toExpireIds.add(b.id);
  }

  // 2. Collect explicitly requested IDs (only if currently active)
  if (hasIdFilter) {
    for (const id of bundleIds!) {
      const bundle = await bundleRepo.findById(id);
      if (!bundle) {
        LOG.warn(`Admin expire: bundle ${id} not found, skipping`);
        continue;
      }
      if (!ACTIVE_STATUSES.includes(bundle.status as BundleStatus)) {
        LOG.warn(`Admin expire: bundle ${id} has status ${bundle.status}, skipping`);
        continue;
      }
      toExpireIds.add(id);
    }
  }

  if (toExpireIds.size === 0) {
    ctx.response.status = Status.OK;
    ctx.response.body = { message: "No eligible bundles found to expire", data: { expired: 0 } };
    return;
  }

  // 3. Bulk-update DB status to EXPIRED
  for (const id of toExpireIds) {
    await bundleRepo.update(id, { status: BundleStatus.EXPIRED, updatedAt: now });
  }

  // 4. Evict from in-memory mempool
  const mempool = getMempool();
  const purged = mempool.purgeBundles([...toExpireIds]);

  LOG.info(`Admin expire: expired ${toExpireIds.size} bundle(s), purged ${purged} from in-memory mempool`);

  ctx.response.status = Status.OK;
  ctx.response.body = {
    message: `Expired ${toExpireIds.size} bundle(s)`,
    data: { expired: toExpireIds.size },
  };
};
