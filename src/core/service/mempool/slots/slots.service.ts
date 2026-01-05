import type { OperationsBundle } from "@/persistence/drizzle/entity/operations-bundle.entity.ts";
import type { SlotItem, SlotAddResult, BundlePriority } from "@/core/service/mempool/types.ts";
import {
  calculateBundlePriority,
  compareBundlePriorities,
} from "@/core/service/mempool/slots/priority-calculator.ts";
import type { SlotItemBuilder } from "@/core/service/mempool/slots/slot-item-builder.ts";
import { LOG } from "@/config/logger.ts";
import type { OperationsBundleRepository } from "@/persistence/drizzle/repository/index.ts";
import * as E from "@/core/service/mempool/mempool.errors.ts";
import { logAndThrow } from "@/utils/error/log-and-throw.ts";

/**
 * Service for managing mempool slots with priority-based insertion
 * 
 * Each slot can hold one bundle. When a new bundle arrives:
 * - If slot is empty, insert directly
 * - If slot is occupied, compare priorities:
 *   - If new bundle has higher priority, replace and try to relocate the displaced bundle
 *   - If not, try next slot
 * - If bundle doesn't fit anywhere, return it to be kept as PENDING
 */
export class SlotsService {
  private slots: (SlotItem | null)[];
  private readonly capacity: number;
  private readonly slotItemBuilder: SlotItemBuilder;
  private readonly bundleRepository: OperationsBundleRepository;

  constructor(
    capacity: number,
    slotItemBuilder: SlotItemBuilder,
    bundleRepository: OperationsBundleRepository
  ) {
    if (capacity <= 0) {
      logAndThrow(new E.INVALID_SLOT_CAPACITY(capacity));
    }
    this.capacity = capacity;
    this.slots = new Array(capacity).fill(null);
    this.slotItemBuilder = slotItemBuilder;
    this.bundleRepository = bundleRepository;
  }

  /**
   * Attempts to add a bundle to the slots
   * 
   * @param bundle - Bundle to add to slots
   * @returns Result indicating if bundle was inserted and any displaced bundle
   */
  async add(bundle: OperationsBundle): Promise<SlotAddResult> {
    // 1. Check if TTL expired
    if (this.isTtlExpired(bundle.ttl)) {
      LOG.debug(`Bundle ${bundle.id} TTL expired`, {
        ttl: bundle.ttl.toISOString(),
        now: new Date().toISOString(),
      });
      return {
        inserted: false,
        reason: "TTL_EXPIRED",
      };
    }

    // 2. Build SlotItem and calculate priority
    const newSlotItem = await this.slotItemBuilder.build(bundle);
    const newPriority = calculateBundlePriority(bundle);

    // 3. Try to insert in first available slot or replace lower priority bundle
    for (let i = 0; i < this.capacity; i++) {
      const currentSlot = this.slots[i];

      if (currentSlot === null) {
        this.slots[i] = newSlotItem;
        LOG.debug(`Bundle ${bundle.id} inserted into slot ${i}`, {
          slotIndex: i,
          fee: bundle.fee.toString(),
        });
        return {
          inserted: true,
          reason: "SUCCESS",
        };
      }

      const currentPriority = this.calculatePriorityFromSlotItem(currentSlot);

      if (compareBundlePriorities(newPriority, currentPriority) > 0) {
        LOG.debug(`Bundle ${bundle.id} has higher priority than ${currentSlot.bundleId} in slot ${i}`, {
          newFee: bundle.fee.toString(),
          currentFee: currentSlot.fee.toString(),
        });

        const displacedBundle = await this.bundleRepository.findById(currentSlot.bundleId);
        if (!displacedBundle) {
          this.slots[i] = newSlotItem;
          LOG.warn(`Displaced bundle ${currentSlot.bundleId} not found in DB, slot ${i} replaced`);
          return {
            inserted: true,
            reason: "SUCCESS",
          };
        }

        this.slots[i] = newSlotItem;
        const relocationResult = await this.tryRelocateBundle(displacedBundle, i + 1);

        if (relocationResult.inserted) {
          LOG.debug(`Displaced bundle ${displacedBundle.id} relocated successfully`);
          return {
            inserted: true,
            reason: "SUCCESS",
          };
        } else {
          LOG.debug(`Displaced bundle ${displacedBundle.id} could not be relocated`, {
            reason: relocationResult.reason,
          });
          return {
            inserted: true,
            displaced: displacedBundle,
            reason: "SUCCESS",
          };
        }
      }
    }

    // 4. No slot available
    LOG.debug(`Bundle ${bundle.id} could not be inserted, no available slots`);
    return {
      inserted: false,
      reason: "NO_CAPACITY",
    };
  }

  /**
   * Tries to relocate a bundle starting from a specific slot index
   * 
   * @param bundle - Bundle to relocate
   * @param startIndex - Starting slot index to search from
   * @returns Result indicating if bundle was relocated
   */
  private async tryRelocateBundle(
    bundle: OperationsBundle,
    startIndex: number
  ): Promise<SlotAddResult> {
    const bundlePriority = calculateBundlePriority(bundle);

    for (let i = startIndex; i < this.capacity; i++) {
      const currentSlot = this.slots[i];

      if (currentSlot === null) {
        const slotItem = await this.slotItemBuilder.build(bundle);
        this.slots[i] = slotItem;
        return {
          inserted: true,
          reason: "SUCCESS",
        };
      }

      const currentPriority = this.calculatePriorityFromSlotItem(currentSlot);

      if (compareBundlePriorities(bundlePriority, currentPriority) > 0) {
        const slotItem = await this.slotItemBuilder.build(bundle);
        this.slots[i] = slotItem;

        const displacedBundle = await this.bundleRepository.findById(currentSlot.bundleId);
        if (!displacedBundle) {
          return {
            inserted: true,
            reason: "SUCCESS",
          };
        }

        return await this.tryRelocateBundle(displacedBundle, i + 1);
      }
    }

    return {
      inserted: false,
      reason: "NO_CAPACITY",
    };
  }

  /**
   * Gets all current slots (non-null only)
   */
  getSlots(): SlotItem[] {
    return this.slots.filter((slot): slot is SlotItem => slot !== null);
  }

  /**
   * Gets all slots including nulls (for debugging)
   */
  getAllSlots(): (SlotItem | null)[] {
    return [...this.slots];
  }

  /**
   * Clears a specific slot
   */
  clearSlot(index: number): void {
    if (index < 0 || index >= this.capacity) {
      logAndThrow(new E.SLOT_INDEX_OUT_OF_BOUNDS(index, this.capacity));
    }
    this.slots[index] = null;
    LOG.debug(`Slot ${index} cleared`);
  }

  /**
   * Clears all slots
   */
  clearAllSlots(): void {
    this.slots.fill(null);
    LOG.debug("All slots cleared");
  }

  /**
   * Gets the number of available (empty) slots
   */
  getAvailableCapacity(): number {
    return this.slots.filter((slot) => slot === null).length;
  }

  /**
   * Gets the number of filled slots
   */
  getFilledSlotsCount(): number {
    return this.slots.filter((slot) => slot !== null).length;
  }

  /**
   * Checks if slots are full
   */
  isFull(): boolean {
    return this.getAvailableCapacity() === 0;
  }

  /**
   * Checks if TTL has expired
   */
  private isTtlExpired(ttl: Date): boolean {
    return new Date() > ttl;
  }

  /**
   * Calculates priority from a SlotItem (has all necessary data)
   */
  private calculatePriorityFromSlotItem(slotItem: SlotItem): BundlePriority {
    return {
      fee: slotItem.fee,
      createdAt: slotItem.createdAt,
      ttl: slotItem.ttl,
      score: 0, // Score not needed for comparison, only for display
    };
  }
}

