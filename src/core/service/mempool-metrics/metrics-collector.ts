import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { MempoolMetricRepository } from "@/persistence/drizzle/repository/mempool-metric.repository.ts";
import { OperationsBundleRepository } from "@/persistence/drizzle/repository/operations-bundle.repository.ts";
import { PpRepository } from "@/persistence/drizzle/repository/pp.repository.ts";
import { CouncilMembershipRepository } from "@/persistence/drizzle/repository/council-membership.repository.ts";
import { CouncilMembershipStatus } from "@/persistence/drizzle/entity/council-membership.entity.ts";
import { BundleStatus } from "@/persistence/drizzle/entity/operations-bundle.entity.ts";
import { getMempool } from "@/core/mempool/index.ts";
import { LOG } from "@/config/logger.ts";

const COLLECTION_INTERVAL_MS = 60_000; // 1 minute
const RETENTION_DAYS = 7;

export class MetricsCollector {
  private intervalId: number | null = null;
  private metricRepo: MempoolMetricRepository;
  private bundleRepo: OperationsBundleRepository;
  private ppRepo: PpRepository;
  private membershipRepo: CouncilMembershipRepository;
  private platformVersion: string;

  constructor(platformVersion: string) {
    this.metricRepo = new MempoolMetricRepository(drizzleClient);
    this.bundleRepo = new OperationsBundleRepository(drizzleClient);
    this.ppRepo = new PpRepository(drizzleClient);
    this.membershipRepo = new CouncilMembershipRepository(drizzleClient);
    this.platformVersion = platformVersion;
  }

  start(): void {
    if (this.intervalId !== null) return;

    // Collect immediately on start, then every interval
    this.collect();
    this.intervalId = setInterval(
      () => this.collect(),
      COLLECTION_INTERVAL_MS,
    ) as unknown as number;

    LOG.info("MetricsCollector started", {
      intervalMs: COLLECTION_INTERVAL_MS,
      platformVersion: this.platformVersion,
    });
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      LOG.info("MetricsCollector stopped");
    }
  }

  private async collect(): Promise<void> {
    try {
      const mempool = getMempool();
      const windowStart = new Date(Date.now() - COLLECTION_INTERVAL_MS);
      const pps = await this.ppRepo.listActive();

      let recorded = 0;
      for (const pp of pps) {
        const memberships = await this.membershipRepo.listAllForPp(
          pp.publicKey,
        );
        const activeChannels = memberships
          .filter((m) => m.status === CouncilMembershipStatus.ACTIVE)
          .map((m) => m.channelAuthId);
        if (activeChannels.length === 0) continue;

        const { queueDepth, slotCount } = mempool.getStatsForChannels(
          activeChannels,
        );
        const completed = await this.bundleRepo
          .findByStatusUpdatedSinceForChannels(
            BundleStatus.COMPLETED,
            windowStart,
            activeChannels,
          );
        const expired = await this.bundleRepo
          .findByStatusUpdatedSinceForChannels(
            BundleStatus.EXPIRED,
            windowStart,
            activeChannels,
          );

        const processingTimesMs = completed
          .filter((b) => b.createdAt && b.updatedAt)
          .map((b) =>
            new Date(b.updatedAt).getTime() - new Date(b.createdAt).getTime()
          )
          .filter((t) => t >= 0);

        const avgProcessingMs = processingTimesMs.length > 0
          ? processingTimesMs.reduce((a, b) => a + b, 0) /
            processingTimesMs.length
          : null;
        const p95ProcessingMs = processingTimesMs.length > 0
          ? percentile(processingTimesMs, 0.95)
          : null;

        const windowMinutes = COLLECTION_INTERVAL_MS / 60_000;
        const throughputPerMin = completed.length / windowMinutes;

        await this.metricRepo.insert({
          platformVersion: this.platformVersion,
          ppPublicKey: pp.publicKey,
          queueDepth,
          slotCount,
          bundlesCompleted: completed.length,
          bundlesExpired: expired.length,
          avgProcessingMs,
          p95ProcessingMs,
          throughputPerMin,
        });
        recorded++;
      }

      LOG.debug("Per-PP metrics snapshot recorded", {
        ppsRecorded: recorded,
      });

      const retentionCutoff = new Date(
        Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000,
      );
      const deleted = await this.metricRepo.deleteOlderThan(retentionCutoff);
      if (deleted > 0) {
        LOG.debug("Cleaned up old metrics", {
          deleted,
          retentionDays: RETENTION_DAYS,
        });
      }
    } catch (error) {
      LOG.error("MetricsCollector failed to collect", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function percentile(values: number[], p: number): number {
  const arr = [...values].sort((a, b) => a - b);
  const idx = Math.ceil(arr.length * p) - 1;
  return arr[Math.max(0, idx)];
}
