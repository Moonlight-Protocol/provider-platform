import type { OperationsBundle } from "@/persistence/drizzle/entity/operations-bundle.entity.ts";
import type { BundlePriority } from "@/core/service/mempool/types.ts";

/**
 * Calculates priority for a bundle
 * 
 * Priority criteria (in order):
 * 1. Higher fee (bigint)
 * 2. Older createdAt (earlier timestamp)
 * 3. Earlier TTL (expires sooner)
 * 
 * @param bundle - Operations bundle to calculate priority for
 * @returns Bundle priority with fee, timestamps, and calculated score
 */
export function calculateBundlePriority(bundle: OperationsBundle): BundlePriority {
  const fee = bundle.fee;
  const createdAt = bundle.createdAt;
  const ttl = bundle.ttl;

  // Calculate score for display/debugging purposes
  // Score is not used in comparison (compareBundlePriorities handles that)
  const feeWeight = 1000000000;
  const createdAtTimestamp = createdAt.getTime();
  const ttlTimestamp = ttl.getTime();
  const score = Number(fee) * feeWeight - createdAtTimestamp - ttlTimestamp;

  return {
    fee,
    createdAt,
    ttl,
    score,
  };
}

/**
 * Compares two bundle priorities
 * @returns positive if bundle1 has higher priority, negative if bundle2 has higher priority, 0 if equal
 */
export function compareBundlePriorities(
  bundle1: BundlePriority,
  bundle2: BundlePriority
): number {
  // Primary: Fee comparison (higher fee = higher priority)
  if (bundle1.fee > bundle2.fee) return 1;
  if (bundle1.fee < bundle2.fee) return -1;
  
  // Secondary: CreatedAt comparison (older = higher priority)
  const createdAtDiff = bundle1.createdAt.getTime() - bundle2.createdAt.getTime();
  if (createdAtDiff !== 0) return createdAtDiff < 0 ? 1 : -1; // Older (smaller timestamp) = higher priority
  
  // Tertiary: TTL comparison (earlier TTL = higher priority)
  const ttlDiff = bundle1.ttl.getTime() - bundle2.ttl.getTime();
  if (ttlDiff !== 0) return ttlDiff < 0 ? 1 : -1; // Earlier (smaller timestamp) = higher priority
  
  return 0; // Equal priority
}

/**
 * Checks if bundle1 has higher priority than bundle2
 */
export function hasHigherPriority(
  bundle1: BundlePriority,
  bundle2: BundlePriority
): boolean {
  return compareBundlePriorities(bundle1, bundle2) > 0;
}

