import type { Context } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { MempoolMetricRepository } from "@/persistence/drizzle/repository/mempool-metric.repository.ts";
import type { PpRepository } from "@/persistence/drizzle/repository/pp.repository.ts";
import type { PaymentProvider } from "@/persistence/drizzle/entity/pp.entity.ts";
import type { Logger } from "@/utils/logger/index.ts";

const DEFAULT_RANGE_MIN = 60; // 1h at 60s snapshots
const MAX_RANGE_MIN = 10_080; // matches MetricsCollector retention (7 days)

let metricRepo = new MempoolMetricRepository(drizzleClient);

/** Test-only seam to inject repos backed by the PGlite test DB. */
export function setMetricsRepoForTests(
  metric: MempoolMetricRepository,
  _pp: PpRepository,
): void {
  metricRepo = metric;
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
    const pp = ctx.state.pp as PaymentProvider;

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

    const since = new Date(Date.now() - rangeMin * 60_000);
    log.event("fetching metric snapshots");
    const rows = await metricRepo.findRecentForPp(
      pp.publicKey,
      since,
      rangeMin,
    );
    log.debug("snapshotCount", rows.length);

    ctx.response.status = 200;
    ctx.response.body = {
      data: {
        ppPublicKey: pp.publicKey,
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
