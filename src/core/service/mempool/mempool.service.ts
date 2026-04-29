import type { SlotBundle } from "@/core/service/bundle/bundle.types.ts";
import type { SlotData } from "@/core/service/mempool/mempool.types.ts";

/**
 * Calculates the total weight of bundles in a slot
 *
 * @param bundles - Array of bundles in the slot
 * @returns Total weight of all bundles
 */
export function calculateSlotWeight(bundles: SlotBundle[]): number {
  return bundles.reduce((total, bundle) => total + bundle.weight, 0);
}

/**
 * Checks if a bundle can fit in a slot considering capacity and weight
 *
 * @param bundle - Bundle to check
 * @param slot - Slot data to check against
 * @returns True if bundle can fit, false otherwise
 */
export function canBundleFitInSlot(
  bundle: SlotBundle,
  slot: SlotData,
): boolean {
  const newWeight = slot.currentWeight + bundle.weight;
  return newWeight <= slot.capacity;
}

/**
 * Compares two bundles by priority score for sorting
 * Higher score = higher priority = should come first
 *
 * @param a - First bundle
 * @param b - Second bundle
 * @returns Negative if a has higher priority, positive if b has higher priority, 0 if equal
 */
export function compareBundlePriority(a: SlotBundle, b: SlotBundle): number {
  // Higher priority score = higher priority = should come first
  // So we reverse the order (b - a instead of a - b)
  return b.priorityScore - a.priorityScore;
}

/**
 * Checks if a bundle has expired based on its TTL
 *
 * @param bundle - Bundle to check
 * @returns True if bundle is expired, false otherwise
 */
export function isBundleExpired(bundle: SlotBundle): boolean {
  return bundle.ttl.getTime() <= Date.now();
}

/**
 * Finds the bundle with the lowest priority in a slot
 * Used when a new bundle needs to replace an existing one
 *
 * @param slot - Slot data to search
 * @returns Bundle with lowest priority, or null if slot is empty
 */
export function findLowestPriorityBundle(slot: SlotData): SlotBundle | null {
  if (slot.bundles.length === 0) {
    return null;
  }

  return slot.bundles.reduce((lowest, current) => {
    return current.priorityScore < lowest.priorityScore ? current : lowest;
  });
}
