import { NETWORK_CONFIG } from "@/config/env.ts";
import { PrivacyChannel } from "@moonlight/moonlight-sdk";

const channelCache = new Map<string, PrivacyChannel>();

/**
 * Get or create a PrivacyChannel client for a specific channel.
 * Cached by channelContractId.
 */
export function getChannelClient(
  channelContractId: string,
  channelAuthId: string,
  assetContractId: string,
): PrivacyChannel {
  const cached = channelCache.get(channelContractId);
  if (cached) return cached;

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
