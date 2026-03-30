import {
  CHANNEL_AUTH_ID,
  CHANNEL_CONTRACT_ID,
  NETWORK_CONFIG,
  CHANNEL_ASSET,
} from "../../config/env.ts";
import { PrivacyChannel } from "@moonlight/moonlight-sdk";

let _channelClient: PrivacyChannel | null = null;
let _configuredContractId = "";

export function getChannelClient(): PrivacyChannel {
  // Invalidate cache if config changed (e.g., after council join)
  if (_channelClient && _configuredContractId !== CHANNEL_CONTRACT_ID) {
    _channelClient = null;
  }
  if (!_channelClient) {
    if (!CHANNEL_CONTRACT_ID || !CHANNEL_AUTH_ID) {
      throw new Error("Channel client not available — no council configured yet");
    }
    _channelClient = new PrivacyChannel(
      NETWORK_CONFIG,
      CHANNEL_CONTRACT_ID,
      CHANNEL_AUTH_ID,
      CHANNEL_ASSET.contractId,
    );
    _configuredContractId = CHANNEL_CONTRACT_ID;
  }
  return _channelClient;
}

// Backwards-compatible export for existing code that uses CHANNEL_CLIENT directly.
// Will throw at access time if channel is not configured.
export const CHANNEL_CLIENT = new Proxy({} as PrivacyChannel, {
  get(_target, prop) {
    return (getChannelClient() as Record<string | symbol, unknown>)[prop];
  },
});
