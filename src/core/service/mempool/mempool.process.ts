import { LOG } from "@/config/logger.ts";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { BundleStatus } from "@/persistence/drizzle/entity/operations-bundle.entity.ts";
import type { OperationsBundle } from "@/persistence/drizzle/entity/operations-bundle.entity.ts";
import { OperationsBundleRepository } from "@/persistence/drizzle/repository/index.ts";
import {
  MEMPOOL_SLOT_CAPACITY,
  MEMPOOL_EXPENSIVE_OP_WEIGHT,
  MEMPOOL_CHEAP_OP_WEIGHT,
} from "@/config/env.ts";
import {
  calculateBundleWeight,
  calculatePriorityScore,
  classifyOperations,
} from "@/core/service/bundle/bundle.service.ts";
import type { SlotBundle, WeightConfig } from "@/core/service/bundle/bundle.types.ts";
import type { OperationTypes } from "@moonlight/moonlight-sdk";
import {
  canBundleFitInSlot,
  compareBundlePriority,
  isBundleExpired,
  findLowestPriorityBundle,
} from "@/core/service/mempool/mempool.service.ts";
import type { MempoolStats } from "@/core/service/mempool/mempool.types.ts";
import * as E from "@/core/service/mempool/mempool.errors.ts";

const MEMPOOL_CONFIG = {
  SLOT_CAPACITY: MEMPOOL_SLOT_CAPACITY,
  WEIGHT_CONFIG: {
    expensiveOpWeight: MEMPOOL_EXPENSIVE_OP_WEIGHT,
    cheapOpWeight: MEMPOOL_CHEAP_OP_WEIGHT,
  } as WeightConfig,
} as const;

const operationsBundleRepository = new OperationsBundleRepository(drizzleClient);

/**
 * Parses MLXDR operations from a bundle entity
 */
async function parseOperationsFromBundle(
  operationsMLXDR: string[]
): Promise<Array<OperationTypes.CreateOperation | OperationTypes.SpendOperation | OperationTypes.DepositOperation | OperationTypes.WithdrawOperation>> {
  const { MoonlightOperation } = await import("@moonlight/moonlight-sdk");
  const operations = await Promise.all(
    operationsMLXDR.map((xdr) => MoonlightOperation.fromMLXDR(xdr))
  );
  return operations as Array<OperationTypes.CreateOperation | OperationTypes.SpendOperation | OperationTypes.DepositOperation | OperationTypes.WithdrawOperation>;
}

/**
 * Creates a SlotBundle from an OperationsBundle entity
 */
async function createSlotBundleFromEntity(
  bundle: OperationsBundle
): Promise<SlotBundle> {
  const operations = await parseOperationsFromBundle(bundle.operationsMLXDR);
  const classified = classifyOperations(operations);
  const weight = calculateBundleWeight(classified, MEMPOOL_CONFIG.WEIGHT_CONFIG);
  const priorityScore = calculatePriorityScore({
    fee: bundle.fee,
    ttl: bundle.ttl,
    createdAt: bundle.createdAt,
  });

  return {
    bundleId: bundle.id,
    operationsMLXDR: bundle.operationsMLXDR,
    operations: classified,
    fee: bundle.fee,
    weight,
    ttl: bundle.ttl,
    createdAt: bundle.createdAt,
    priorityScore,
  };
}

/**
 * Loads pending and processing bundles from database
 */
async function loadPendingBundlesFromDB(): Promise<SlotBundle[]> {
  const bundles = await operationsBundleRepository.findPendingOrProcessing();
  const slotBundles = await Promise.all(
    bundles.map((bundle: OperationsBundle) => createSlotBundleFromEntity(bundle))
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

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  /**
   * Attempts to add a bundle to the slot
   * Returns the bundle that was removed (if any) or null if the new bundle fits
   */
  add(bundle: SlotBundle): SlotBundle | null {
    // Check if bundle fits directly
    if (this.currentWeight + bundle.weight <= this.capacity) {
      this.bundles.push(bundle);
      this.bundles.sort(compareBundlePriority);
      this.currentWeight += bundle.weight;
      return null;
    }

    // Check if we can replace a lower priority bundle
    const lowestPriority = findLowestPriorityBundle({
      bundles: this.bundles,
      currentWeight: this.currentWeight,
      capacity: this.capacity,
    });

    if (lowestPriority && bundle.priorityScore > lowestPriority.priorityScore) {
      // Replace the lowest priority bundle
      const removedIndex = this.bundles.indexOf(lowestPriority);
      this.bundles.splice(removedIndex, 1);
      this.currentWeight -= lowestPriority.weight;

      this.bundles.push(bundle);
      this.bundles.sort(compareBundlePriority);
      this.currentWeight += bundle.weight;

      return lowestPriority;
    }

    // Bundle doesn't fit and can't replace any existing bundle
    return bundle;
  }

  /**
   * Checks if a bundle can fit in this slot
   */
  canFit(bundle: SlotBundle): boolean {
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
    if (this.bundles.length === 0) {
      return null;
    }

    const bundle = this.bundles.shift()!;
    this.currentWeight -= bundle.weight;
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
    const index = this.bundles.findIndex((b) => b.bundleId === bundleId);
    if (index !== -1) {
      const bundle = this.bundles[index];
      this.bundles.splice(index, 1);
      this.currentWeight -= bundle.weight;
      return true;
    }
    return false;
  }
}


/**
 * Mempool service for managing transaction queue with slots
 */
export class Mempool {
  private slots: Slot[] = [];
  private capacity: number;

  constructor(capacity: number = MEMPOOL_CONFIG.SLOT_CAPACITY) {
    this.capacity = capacity;
  }

  /**
   * Initializes the mempool by loading pending and processing bundles from database
   */
  async initialize(): Promise<void> {
    LOG.info("Initializing mempool from database...");
    const bundles = await loadPendingBundlesFromDB();

    // Create slots and distribute bundles
    for (const bundle of bundles) {
      await this.addBundle(bundle);
    }

    LOG.info(`Mempool initialized with ${this.slots.length} slots and ${this.getTotalBundles()} bundles`);
  }

  /**
   * Adds a bundle to the mempool
   * Tries to fit in existing slots, creates new slot if necessary
   */
  async addBundle(bundleData: SlotBundle): Promise<void> {
    // Check if bundle is expired
    if (isBundleExpired(bundleData)) {
      LOG.warn(`Bundle ${bundleData.bundleId} is expired, marking as EXPIRED`);
      await operationsBundleRepository.update(bundleData.bundleId, {
        status: BundleStatus.EXPIRED,
        updatedAt: new Date(),
      });
      return;
    }

    let bundleToAdd: SlotBundle | null = bundleData;

    // Try to fit in existing slots
    for (const slot of this.slots) {
      if (!bundleToAdd) break;

      const removed = slot.add(bundleToAdd);
      if (removed === null) {
        // Bundle was successfully added
        bundleToAdd = null;
        LOG.debug(`Bundle ${bundleData.bundleId} added to existing slot`);
      } else if (removed !== bundleToAdd) {
        // A different bundle was removed, try to re-add the removed one
        bundleToAdd = removed;
      }
    }

    // If bundle still needs to be added, create a new slot
    if (bundleToAdd) {
      const newSlot = new Slot(this.capacity);
      const result = newSlot.add(bundleToAdd);
      if (result === null) {
        this.slots.push(newSlot);
        LOG.debug(`Bundle ${bundleData.bundleId} added to new slot`);
      } else {
        // Even new slot can't fit (shouldn't happen if capacity is reasonable)
        LOG.error(`Bundle ${bundleData.bundleId} cannot fit in any slot, weight: ${bundleData.weight}, capacity: ${this.capacity}`);
        throw new E.SLOT_FULL(bundleData.weight, this.capacity);
      }
    }

    // Update bundle status to PROCESSING
    await operationsBundleRepository.update(bundleData.bundleId, {
      status: BundleStatus.PROCESSING,
      updatedAt: new Date(),
    });
  }

  /**
   * Gets the next slot (first in queue)
   */
  getNextSlot(): Slot | null {
    return this.slots.length > 0 ? this.slots[0] : null;
  }

  /**
   * Removes and returns the first slot
   */
  removeFirstSlot(): Slot | null {
    if (this.slots.length === 0) {
      return null;
    }
    return this.slots.shift() || null;
  }

  /**
   * Re-adds bundles to the mempool after execution failure
   * Used to restore bundles that failed during execution
   * 
   * @param bundles - Array of bundles to re-add
   */
  async reAddBundles(bundles: SlotBundle[]): Promise<void> {
    LOG.debug(`Re-adding ${bundles.length} bundles to mempool after execution failure`);

    for (const bundle of bundles) {
      try {
        await this.addBundle(bundle);
        LOG.debug(`Bundle ${bundle.bundleId} re-added to mempool`);
      } catch (error) {
        LOG.error(`Failed to re-add bundle ${bundle.bundleId}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Expires bundles that have passed their TTL
   */
  async expireBundles(): Promise<void> {
    const expiredBundleIds: string[] = [];

    // Collect expired bundles from all slots
    for (let i = this.slots.length - 1; i >= 0; i--) {
      const slot = this.slots[i];
      const bundles = slot.getBundles();
      
      for (const bundle of bundles) {
        if (isBundleExpired(bundle)) {
          expiredBundleIds.push(bundle.bundleId);
          // Remove the expired bundle from slot
          this.removeBundleFromSlot(slot, bundle.bundleId);
        }
      }

      // Remove empty slots
      if (slot.isEmpty()) {
        this.slots.splice(i, 1);
      }
    }

    // Update expired bundles in database
    for (const bundleId of expiredBundleIds) {
      await operationsBundleRepository.update(bundleId, {
        status: BundleStatus.EXPIRED,
        updatedAt: new Date(),
      });
      LOG.info(`Bundle ${bundleId} expired and marked as EXPIRED`);
    }
  }

  /**
   * Removes a specific bundle from a slot by bundleId
   */
  private removeBundleFromSlot(slot: Slot, bundleId: string): void {
    const removed = slot.removeBundle(bundleId);
    if (!removed) {
      LOG.warn(`Bundle ${bundleId} not found in slot for removal`);
    }
  }

  /**
   * Gets statistics about the mempool
   */
  getStats(): MempoolStats {
    const totalBundles = this.getTotalBundles();
    const totalWeight = this.slots.reduce((sum, slot) => sum + slot.getTotalWeight(), 0);
    const totalSlots = this.slots.length;

    return {
      totalSlots,
      totalBundles,
      totalWeight,
      averageBundlesPerSlot: totalSlots > 0 ? totalBundles / totalSlots : 0,
    };
  }

  /**
   * Gets total number of bundles across all slots
   */
  private getTotalBundles(): number {
    return this.slots.reduce((sum, slot) => sum + slot.getBundleCount(), 0);
  }
}

