import type { SlotBundle } from "@/core/service/bundle/bundle.types.ts";

/**
 * Slot data structure containing bundles to be sent in a single transaction
 */
export type SlotData = {
  bundles: SlotBundle[];
  currentWeight: number;
  capacity: number;
};

/**
 * Statistics about the mempool state
 */
export type MempoolStats = {
  totalSlots: number;
  totalBundles: number;
  totalWeight: number;
  averageBundlesPerSlot: number;
};
