import { NETWORK_CONFIG } from "@/config/env.ts";
import { PrivacyChannel } from "@moonlight/moonlight-sdk";

const MAX_CACHE_SIZE = 100;
const channelCache = new Map<string, PrivacyChannel>();

/**
 * Get or create a PrivacyChannel client for a specific channel.
 * Cached by channelContractId. Evicts the oldest entry when the cache exceeds MAX_CACHE_SIZE.
 */
export function getChannelClient(
  channelContractId: string,
  channelAuthId: string,
  assetContractId: string,
): PrivacyChannel {
  const cached = channelCache.get(channelContractId);
  if (cached) return cached;

  // Evict oldest entry (first inserted) when cache is full
  if (channelCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = channelCache.keys().next().value;
    if (oldestKey !== undefined) {
      channelCache.delete(oldestKey);
    }
  }

  const client = new PrivacyChannel(
    NETWORK_CONFIG,
    channelContractId as `C${string}`,
    channelAuthId as `C${string}`,
    assetContractId as `C${string}`,
  );
  channelCache.set(channelContractId, client);
  return client;
}

/** Clear the cache (e.g., on config change). */
export function clearChannelCache(): void {
  channelCache.clear();
}
