import type { Context } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { MempoolMetricRepository } from "@/persistence/drizzle/repository/mempool-metric.repository.ts";
import { PpRepository } from "@/persistence/drizzle/repository/pp.repository.ts";
import type { Logger } from "@/utils/logger/index.ts";

const DEFAULT_RANGE_MIN = 60; // 1h at 60s snapshots
const MAX_RANGE_MIN = 10_080; // matches MetricsCollector retention (7 days)

let metricRepo = new MempoolMetricRepository(drizzleClient);
let ppRepo = new PpRepository(drizzleClient);

/** Test-only seam to inject repos backed by the PGlite test DB. */
export function setMetricsRepoForTests(
  metric: MempoolMetricRepository,
  pp: PpRepository,
): void {
  metricRepo = metric;
  ppRepo = pp;
}

function parseRangeMin(raw: string | null): number | null {
  if (raw === null) return DEFAULT_RANGE_MIN;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return Math.min(parsed, MAX_RANGE_MIN);
}

export function handleGetMetrics(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("getMetrics");

  return async (ctx) => {
    log.info("getMetrics");
    const ownerPublicKey = (ctx.state.session as { sub: string }).sub;
    const ppPublicKey = ctx.request.url.searchParams.get("ppPublicKey");
    log.debug("ppPublicKey", ppPublicKey);

    if (!ppPublicKey) {
      ctx.response.status = 400;
      ctx.response.body = {
        error: "Missing required query param: ppPublicKey",
      };
      return;
    }

    const rangeMin = parseRangeMin(
      ctx.request.url.searchParams.get("rangeMin"),
    );
    log.debug("rangeMin", rangeMin);
    if (rangeMin === null) {
      ctx.response.status = 400;
      ctx.response.body = {
        error: "rangeMin must be a positive integer",
      };
      return;
    }

    log.event("verifying PP ownership");
    const pp = await ppRepo.findByPublicKeyAndOwner(
      ppPublicKey,
      ownerPublicKey,
    );
    if (!pp) {
      ctx.response.status = 403;
      ctx.response.body = { error: "PP not owned by authenticated operator" };
      return;
    }

    const since = new Date(Date.now() - rangeMin * 60_000);
    log.event("fetching metric snapshots");
    const rows = await metricRepo.findRecentForPp(
      ppPublicKey,
      since,
      rangeMin,
    );
    log.debug("snapshotCount", rows.length);

    ctx.response.status = 200;
    ctx.response.body = {
      data: {
        ppPublicKey,
        rangeMin,
        since: since.toISOString(),
        snapshots: rows.map((row) => ({
          recordedAt: row.recordedAt,
          platformVersion: row.platformVersion,
          queueDepth: row.queueDepth,
          slotCount: row.slotCount,
          bundlesCompleted: row.bundlesCompleted,
          bundlesExpired: row.bundlesExpired,
          bundlesFailed: row.bundlesFailed,
          avgProcessingMs: row.avgProcessingMs,
          p95ProcessingMs: row.p95ProcessingMs,
          throughputPerMin: row.throughputPerMin,
        })),
      },
    };
    log.event("metrics response assembled");
  };
}
