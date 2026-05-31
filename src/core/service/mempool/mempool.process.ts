import type { Logger } from "@/utils/logger/index.ts";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { BundleStatus } from "@/persistence/drizzle/entity/operations-bundle.entity.ts";
import type { OperationsBundle } from "@/persistence/drizzle/entity/operations-bundle.entity.ts";
import {
  AccountRepository,
  EntityRepository,
  OperationsBundleRepository,
} from "@/persistence/drizzle/repository/index.ts";
import {
  MEMPOOL_CHEAP_OP_WEIGHT,
  MEMPOOL_EXPENSIVE_OP_WEIGHT,
  MEMPOOL_SLOT_CAPACITY,
  MEMPOOL_STARTUP_MAX_BUNDLE_AGE_MS,
} from "@/config/env.ts";
import {
  calculateBundleWeight,
  calculatePriorityScore,
  classifyOperations,
} from "@/core/service/bundle/bundle.service.ts";
import type {
  ClassifiedOperations,
  SlotBundle,
  WeightConfig,
} from "@/core/service/bundle/bundle.types.ts";
import type { OperationTypes } from "@moonlight/moonlight-sdk";
import {
  canBundleFitInSlot,
  compareBundlePriority,
  findLowestPriorityBundle,
  isBundleExpired,
} from "@/core/service/mempool/mempool.service.ts";
import type { MempoolStats } from "@/core/service/mempool/mempool.types.ts";
import * as E from "@/core/service/mempool/mempool.errors.ts";
import { withSpan } from "@/core/tracing.ts";
import { emitForPp } from "@/core/service/events/emit-helpers.ts";

const MEMPOOL_CONFIG = {
  SLOT_CAPACITY: MEMPOOL_SLOT_CAPACITY,
  WEIGHT_CONFIG: {
    expensiveOpWeight: MEMPOOL_EXPENSIVE_OP_WEIGHT,
    cheapOpWeight: MEMPOOL_CHEAP_OP_WEIGHT,
  } as WeightConfig,
} as const;

const operationsBundleRepository = new OperationsBundleRepository(
  drizzleClient,
);
const accountRepository = new AccountRepository(drizzleClient);
const entityRepository = new EntityRepository(drizzleClient);

/**
 * Parses MLXDR operations from a bundle entity
 */
async function parseOperationsFromBundle(
  operationsMLXDR: string[],
  deps: { log: Logger },
): Promise<
  Array<
    | OperationTypes.CreateOperation
    | OperationTypes.SpendOperation
    | OperationTypes.DepositOperation
    | OperationTypes.WithdrawOperation
  >
> {
  const log = deps.log.scope("parseOperationsFromBundle");
  log.info("parseOperationsFromBundle");
  log.debug("count", operationsMLXDR.length);
  log.event("parsing operations from MLXDR");
  const { MoonlightOperation } = await import("@moonlight/moonlight-sdk");
  const operations = await Promise.all(
    operationsMLXDR.map((xdr) => MoonlightOperation.fromMLXDR(xdr)),
  );
  return operations as Array<
    | OperationTypes.CreateOperation
    | OperationTypes.SpendOperation
    | OperationTypes.DepositOperation
    | OperationTypes.WithdrawOperation
  >;
}

/**
 * Creates a SlotBundle from an OperationsBundle entity
 */
function aggregateBundleAmount(
  classified: ClassifiedOperations,
): string | null {
  const sum = (
    list: Array<{ getAmount: () => bigint }>,
  ): bigint => list.reduce((acc, op) => acc + op.getAmount(), 0n);
  if (classified.deposit.length > 0) return sum(classified.deposit).toString();
  if (classified.withdraw.length > 0) {
    return sum(classified.withdraw).toString();
  }
  if (classified.create.length > 0) return sum(classified.create).toString();
  return null;
}

async function lookupSubmitter(
  pubkey: string | null,
): Promise<{ name: string | null; jurisdictions: string[] }> {
  if (!pubkey) return { name: null, jurisdictions: [] };
  const account = await accountRepository.findById(pubkey);
  if (!account) return { name: null, jurisdictions: [] };
  const entity = await entityRepository.findById(account.entityId);
  if (!entity) return { name: null, jurisdictions: [] };
  return { name: entity.name, jurisdictions: entity.jurisdictions ?? [] };
}

export async function createSlotBundleFromEntity(
  bundle: OperationsBundle,
  deps: { log: Logger },
): Promise<SlotBundle> {
  const log = deps.log.scope("createSlotBundleFromEntity");
  log.info("createSlotBundleFromEntity");
  log.debug("bundleId", bundle.id);

  log.event("parsing operations and classifying");
  const operations = await parseOperationsFromBundle(
    bundle.operationsMLXDR,
    deps,
  );
  const classified = classifyOperations(operations);
  const weight = calculateBundleWeight(
    classified,
    MEMPOOL_CONFIG.WEIGHT_CONFIG,
  );
  const priorityScore = calculatePriorityScore({
    fee: bundle.fee,
    ttl: bundle.ttl,
    createdAt: bundle.createdAt,
  });

  log.event("looking up submitter entity");
  const submitter = await lookupSubmitter(bundle.createdBy);

  log.debug("weight", weight);
  log.debug("priorityScore", priorityScore);
  return {
    bundleId: bundle.id,
    channelContractId: bundle.channelContractId ?? "",
    operationsMLXDR: bundle.operationsMLXDR,
    operations: classified,
    fee: bundle.fee,
    weight,
    ttl: bundle.ttl,
    createdAt: bundle.createdAt,
    priorityScore,
    retryCount: bundle.retryCount ?? 0,
    lastFailureReason: bundle.lastFailureReason ?? null,
    ppPublicKey: bundle.ppPublicKey ?? "",
    entityName: submitter.name,
    jurisdictions: submitter.jurisdictions,
    amount: aggregateBundleAmount(classified),
  };
}

/**
 * Loads pending and processing bundles from database
 */
async function loadPendingBundlesFromDB(
  deps: { log: Logger },
): Promise<SlotBundle[]> {
  const log = deps.log.scope("loadPendingBundlesFromDB");
  log.info("loadPendingBundlesFromDB");
  log.event("querying pending/processing bundles");
  const bundles = await operationsBundleRepository.findPendingOrProcessing();
  log.debug("count", bundles.length);
  log.event("hydrating SlotBundles");
  const slotBundles = await Promise.all(
    bundles.map((bundle: OperationsBundle) =>
      createSlotBundleFromEntity(bundle, deps)
    ),
  );
  return slotBundles;
}

/**
 * Slot class for managing bundles within a capacity limit
 */
export class Slot {
  private bundles: SlotBundle[] = [];
  private currentWeight: number = 0;
  private capacity: number;
  private log: Logger;
  /** All bundles in a slot must target the same channel. */
  readonly channelContractId: string;

  constructor(
    capacity: number,
    channelContractId: string,
    deps: { log: Logger },
  ) {
    this.capacity = capacity;
    this.channelContractId = channelContractId;
    this.log = deps.log.scope("Slot");
  }

  /**
   * Attempts to add a bundle to the slot
   * Returns the bundle that was removed (if any) or null if the new bundle fits
   */
  add(bundle: SlotBundle): SlotBundle | null {
    this.log.info("add");
    this.log.debug("bundleId", bundle.bundleId);
    this.log.debug("bundleWeight", bundle.weight);

    if (this.currentWeight + bundle.weight <= this.capacity) {
      this.bundles.push(bundle);
      this.bundles.sort(compareBundlePriority);
      this.currentWeight += bundle.weight;
      this.log.event("bundle added directly (capacity available)");
      return null;
    }

    const lowestPriority = findLowestPriorityBundle({
      bundles: this.bundles,
      currentWeight: this.currentWeight,
      capacity: this.capacity,
    });

    if (lowestPriority && bundle.priorityScore > lowestPriority.priorityScore) {
      const removedIndex = this.bundles.indexOf(lowestPriority);
      this.bundles.splice(removedIndex, 1);
      this.currentWeight -= lowestPriority.weight;

      this.bundles.push(bundle);
      this.bundles.sort(compareBundlePriority);
      this.currentWeight += bundle.weight;

      this.log.event("bundle replaced lower-priority occupant");
      return lowestPriority;
    }

    this.log.event("bundle rejected (no fit, no replaceable occupant)");
    return bundle;
  }

  /**
   * Checks if a bundle can fit in this slot
   */
  canFit(bundle: SlotBundle): boolean {
    this.log.info("canFit");
    this.log.debug("bundleId", bundle.bundleId);
    return canBundleFitInSlot(bundle, {
      bundles: this.bundles,
      currentWeight: this.currentWeight,
      capacity: this.capacity,
    });
  }

  /**
   * Removes and returns the first bundle (highest priority)
   */
  removeFirst(): SlotBundle | null {
    this.log.info("removeFirst");
    if (this.bundles.length === 0) {
      this.log.event("slot empty");
      return null;
    }

    const bundle = this.bundles.shift()!;
    this.currentWeight -= bundle.weight;
    this.log.debug("bundleId", bundle.bundleId);
    this.log.event("first bundle removed");
    return bundle;
  }

  /**
   * Checks if the slot is empty
   */
  isEmpty(): boolean {
    return this.bundles.length === 0;
  }

  /**
   * Gets the total weight of bundles in the slot
   */
  getTotalWeight(): number {
    return this.currentWeight;
  }

  /**
   * Gets the number of bundles in the slot
   */
  getBundleCount(): number {
    return this.bundles.length;
  }

  /**
   * Gets all bundles in the slot (ordered by priority)
   */
  getBundles(): SlotBundle[] {
    return [...this.bundles];
  }

  /**
   * Removes a specific bundle by bundleId
   * Returns true if bundle was found and removed, false otherwise
   */
  removeBundle(bundleId: string): boolean {
    this.log.info("removeBundle");
    this.log.debug("bundleId", bundleId);
    const index = this.bundles.findIndex((b) => b.bundleId === bundleId);
    if (index !== -1) {
      const bundle = this.bundles[index];
      this.bundles.splice(index, 1);
      this.currentWeight -= bundle.weight;
      this.log.event("bundle removed");
      return true;
    }
    this.log.event("bundle not in slot");
    return false;
  }
}

/**
 * Mempool service for managing transaction queue with slots
 */
export class Mempool {
  private slots: Slot[] = [];
  private capacity: number;
  private log: Logger;

  constructor(
    capacity: number = MEMPOOL_CONFIG.SLOT_CAPACITY,
    deps: { log: Logger },
  ) {
    this.capacity = capacity;
    this.log = deps.log.scope("Mempool");
  }

  /**
   * Initializes the mempool by loading pending and processing bundles from database
   */
  async initialize(): Promise<void> {
    this.log.info("initialize");
    this.log.event("Initializing mempool from database...");

    if (MEMPOOL_STARTUP_MAX_BUNDLE_AGE_MS > 0) {
      const STARTUP_EXPIRY_BATCH_LIMIT = 10_000;
      const cutoff = new Date(Date.now() - MEMPOOL_STARTUP_MAX_BUNDLE_AGE_MS);
      let totalExpired = 0;
      let batch: string[];
      do {
        batch = await operationsBundleRepository.expireOlderThan(cutoff, [
          BundleStatus.PENDING,
          BundleStatus.PROCESSING,
        ], STARTUP_EXPIRY_BATCH_LIMIT);
        totalExpired += batch.length;
      } while (batch.length >= STARTUP_EXPIRY_BATCH_LIMIT);
      this.log.event(
        `Startup expiry: marked ${totalExpired} stale bundle(s) as EXPIRED (older than ${MEMPOOL_STARTUP_MAX_BUNDLE_AGE_MS}ms)`,
      );
    } else {
      this.log.event(
        "Startup expiry disabled (MEMPOOL_STARTUP_MAX_BUNDLE_AGE_MS=0)",
      );
    }

    const bundles = await loadPendingBundlesFromDB({ log: this.log });

    // Create slots and distribute bundles
    for (const bundle of bundles) {
      await this.addBundle(bundle);
    }

    this.log.event(
      `Mempool initialized with ${this.slots.length} slots and ${this.getTotalBundles()} bundles`,
    );
  }

  /**
   * Adds a bundle to the mempool
   * Tries to fit in existing slots, creates new slot if necessary
   */
  addBundle(bundleData: SlotBundle): Promise<void> {
    return withSpan("Mempool.addBundle", async (span) => {
      this.log.info("addBundle");
      this.log.debug("bundleId", bundleData.bundleId);
      this.log.debug("bundleWeight", bundleData.weight);

      span.setAttribute("bundle.id", bundleData.bundleId);
      span.setAttribute("bundle.weight", bundleData.weight);

      if (isBundleExpired(bundleData)) {
        span.addEvent("bundle_expired");
        this.log.event(
          `Bundle ${bundleData.bundleId} is expired, marking as EXPIRED`,
        );
        await operationsBundleRepository.update(bundleData.bundleId, {
          status: BundleStatus.EXPIRED,
          updatedAt: new Date(),
        });
        await emitForPp(bundleData.ppPublicKey, (scope) => ({
          kind: "mempool.bundle_expired",
          ts: Date.now(),
          scope,
          payload: {
            bundleId: bundleData.bundleId,
            channelContractId: bundleData.channelContractId,
          },
        }), { log: this.log });
        return;
      }

      let bundleToAdd: SlotBundle | null = bundleData;
      const channel = bundleData.channelContractId;

      // Only try slots that match this bundle's channel
      for (const slot of this.slots) {
        if (!bundleToAdd) break;
        if (slot.channelContractId !== channel) continue;

        const removed = slot.add(bundleToAdd);
        if (removed === null) {
          bundleToAdd = null;
          span.addEvent("added_to_existing_slot");
          this.log.event(
            `Bundle ${bundleData.bundleId} added to existing slot`,
          );
          await emitForPp(bundleData.ppPublicKey, (scope) => ({
            kind: "mempool.bundle_added",
            ts: Date.now(),
            scope,
            payload: {
              bundleId: bundleData.bundleId,
              weight: bundleData.weight,
              channelContractId: channel,
              newSlot: false,
              entityName: bundleData.entityName,
              jurisdictions: bundleData.jurisdictions,
              amount: bundleData.amount,
            },
          }), { log: this.log });
        } else if (removed !== bundleToAdd) {
          bundleToAdd = removed;
        }
      }

      if (bundleToAdd) {
        const newSlot = new Slot(this.capacity, channel, { log: this.log });
        const result = newSlot.add(bundleToAdd);
        if (result === null) {
          this.slots.push(newSlot);
          span.addEvent("added_to_new_slot");
          this.log.event(`Bundle ${bundleData.bundleId} added to new slot`);
          await emitForPp(bundleData.ppPublicKey, (scope) => ({
            kind: "mempool.bundle_added",
            ts: Date.now(),
            scope,
            payload: {
              bundleId: bundleData.bundleId,
              weight: bundleData.weight,
              channelContractId: channel,
              newSlot: true,
              entityName: bundleData.entityName,
              jurisdictions: bundleData.jurisdictions,
              amount: bundleData.amount,
            },
          }), { log: this.log });
        } else {
          span.addEvent("slot_full", {
            "bundle.weight": bundleData.weight,
            "slot.capacity": this.capacity,
          });
          this.log.error(
            new E.SLOT_FULL(bundleData.weight, this.capacity),
            `Bundle ${bundleData.bundleId} cannot fit in any slot`,
          );
          throw new E.SLOT_FULL(bundleData.weight, this.capacity);
        }
      }

      span.addEvent("updating_status_to_processing");
      try {
        const updated = await operationsBundleRepository.updateStatusIfActive(
          bundleData.bundleId,
          BundleStatus.PROCESSING,
          [BundleStatus.PENDING, BundleStatus.PROCESSING],
        );
        if (updated) return;

        span.addEvent("bundle_status_not_active");
        this.log.event(
          `Bundle ${bundleData.bundleId} was concurrently moved to a terminal status, removing from mempool`,
        );
        this.purgeBundles([bundleData.bundleId]);
      } catch (error) {
        span.addEvent("bundle_status_update_failed");
        this.log.error(
          error,
          `Failed to mark bundle ${bundleData.bundleId} as PROCESSING`,
        );
        this.purgeBundles([bundleData.bundleId]);
        throw error;
      }
    });
  }

  /**
   * Gets the next slot (first in queue)
   */
  getNextSlot(): Slot | null {
    this.log.info("getNextSlot");
    return this.slots.length > 0 ? this.slots[0] : null;
  }

  /**
   * Removes and returns the first slot
   */
  removeFirstSlot(): Slot | null {
    this.log.info("removeFirstSlot");
    if (this.slots.length === 0) {
      this.log.event("no slots to remove");
      return null;
    }
    this.log.event("removing first slot");
    return this.slots.shift() || null;
  }

  /**
   * Re-adds bundles to the mempool after execution failure
   * Used to restore bundles that failed during execution
   *
   * @param bundles - Array of bundles to re-add
   */
  reAddBundles(bundles: SlotBundle[]): Promise<void> {
    return withSpan("Mempool.reAddBundles", async (span) => {
      this.log.info("reAddBundles");
      span.addEvent("re_adding_bundles", { "bundles.count": bundles.length });
      this.log.debug("count", bundles.length);
      this.log.event("re-adding bundles to mempool after execution failure");

      let succeeded = 0;
      let failed = 0;
      for (const bundle of bundles) {
        try {
          await this.addBundle(bundle);
          succeeded++;
          this.log.event(`Bundle ${bundle.bundleId} re-added to mempool`);
        } catch (_error) {
          failed++;
          span.addEvent("re_add_failed", { "bundle.id": bundle.bundleId });
          this.log.error(
            new Error(String(`Failed to re-add bundle ${bundle.bundleId}`)),
            `Failed to re-add bundle ${bundle.bundleId}`,
          );
        }
      }
      span.addEvent("re_add_complete", {
        "succeeded": succeeded,
        "failed": failed,
      });
    });
  }

  /**
   * Expires bundles that have passed their TTL
   */
  expireBundles(): Promise<void> {
    return withSpan("Mempool.expireBundles", async (span) => {
      this.log.info("expireBundles");
      const expired: Array<{
        bundleId: string;
        channelContractId: string;
        ppPublicKey: string;
      }> = [];

      this.log.event("scanning for expired bundles");
      for (let i = this.slots.length - 1; i >= 0; i--) {
        const slot = this.slots[i];
        const bundles = slot.getBundles();

        for (const bundle of bundles) {
          if (isBundleExpired(bundle)) {
            expired.push({
              bundleId: bundle.bundleId,
              channelContractId: bundle.channelContractId,
              ppPublicKey: bundle.ppPublicKey,
            });
            this.removeBundleFromSlot(slot, bundle.bundleId);
          }
        }

        if (slot.isEmpty()) {
          this.slots.splice(i, 1);
        }
      }

      if (expired.length > 0) {
        span.addEvent("expiring_bundles", {
          "expired.count": expired.length,
        });
      }

      for (const { bundleId, channelContractId, ppPublicKey } of expired) {
        await operationsBundleRepository.update(bundleId, {
          status: BundleStatus.EXPIRED,
          updatedAt: new Date(),
        });
        this.log.event(`Bundle ${bundleId} expired and marked as EXPIRED`);
        await emitForPp(ppPublicKey, (scope) => ({
          kind: "mempool.bundle_expired",
          ts: Date.now(),
          scope,
          payload: { bundleId, channelContractId },
        }), { log: this.log });
      }
    });
  }

  /**
   * Evicts a set of bundles from in-memory slots by their IDs.
   * Does not touch the database — callers are responsible for updating DB status.
   * Returns the number of bundles that were actually found and removed.
   */
  purgeBundles(bundleIds: string[]): number {
    this.log.info("purgeBundles");
    this.log.debug("requestedCount", bundleIds.length);
    if (bundleIds.length === 0) return 0;

    const idSet = new Set(bundleIds);
    let removed = 0;

    this.log.event("scanning slots for bundles to purge");
    for (let i = this.slots.length - 1; i >= 0; i--) {
      const slot = this.slots[i];
      for (const bundle of slot.getBundles()) {
        if (idSet.has(bundle.bundleId)) {
          this.removeBundleFromSlot(slot, bundle.bundleId);
          removed++;
        }
      }
      if (slot.isEmpty()) {
        this.slots.splice(i, 1);
      }
    }

    this.log.debug("removed", removed);
    this.log.event("purge complete");
    return removed;
  }

  /**
   * Removes a specific bundle from a slot by bundleId
   */
  private removeBundleFromSlot(slot: Slot, bundleId: string): void {
    this.log.info("removeBundleFromSlot");
    this.log.debug("bundleId", bundleId);
    const removed = slot.removeBundle(bundleId);
    if (!removed) {
      this.log.event(`Bundle ${bundleId} not found in slot for removal`);
    }
  }

  /**
   * Gets statistics about the mempool
   */
  getStats(): MempoolStats {
    this.log.info("getStats");
    const totalBundles = this.getTotalBundles();
    const totalWeight = this.slots.reduce(
      (sum, slot) => sum + slot.getTotalWeight(),
      0,
    );
    const totalSlots = this.slots.length;

    this.log.debug("totalSlots", totalSlots);
    this.log.debug("totalBundles", totalBundles);
    return {
      totalSlots,
      totalBundles,
      totalWeight,
      averageBundlesPerSlot: totalSlots > 0 ? totalBundles / totalSlots : 0,
    };
  }

  /**
   * Aggregate stats restricted to the given channels. Used by the
   * per-PP metrics collector — counts only slots/bundles whose
   * channelContractId is in the provided set.
   */
  getStatsForChannels(
    channelContractIds: string[],
  ): { queueDepth: number; slotCount: number } {
    this.log.info("getStatsForChannels");
    this.log.debug("channelCount", channelContractIds.length);
    if (channelContractIds.length === 0) {
      return { queueDepth: 0, slotCount: 0 };
    }
    const allowed = new Set(channelContractIds);
    let slotCount = 0;
    let queueDepth = 0;
    for (const slot of this.slots) {
      if (!allowed.has(slot.channelContractId)) continue;
      slotCount++;
      queueDepth += slot.getBundleCount();
    }
    return { queueDepth, slotCount };
  }

  /**
   * Gets total number of bundles across all slots
   */
  private getTotalBundles(): number {
    return this.slots.reduce((sum, slot) => sum + slot.getBundleCount(), 0);
  }
}
