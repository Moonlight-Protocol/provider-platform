import { CHANNEL_AUTH_ID, PROVIDER_SIGNER, CHALLENGE_TTL } from "@/config/env.ts";
import { EventWatcher } from "./event-watcher.process.ts";
import { ChannelRegistry } from "./channel-registry.ts";
import { setChallengeTtlMs } from "@/core/service/auth/dashboard-auth.ts";
import { LOG } from "@/config/logger.ts";

// Wire env CHALLENGE_TTL (seconds) to dashboard auth (ms)
setChallengeTtlMs(CHALLENGE_TTL * 1000);

/**
 * Singleton instances for event watching and channel registry.
 *
 * The ChannelRegistry is initialized with the currently configured
 * channel (CHANNEL_AUTH_ID from env). The EventWatcher polls for
 * on-chain events and feeds them to the registry.
 *
 * Events are filtered to only process those relevant to this PP's
 * provider address.
 */

// The channel this instance is configured to serve
const configuredChannels = [CHANNEL_AUTH_ID];

export const channelRegistry = new ChannelRegistry(configuredChannels);

export const eventWatcher = new EventWatcher({
  contractId: CHANNEL_AUTH_ID,
});

const providerAddress = PROVIDER_SIGNER.publicKey();

// Only process events relevant to this PP's provider address
eventWatcher.onEvent((event) => {
  if (event.address === providerAddress || event.type === "contract_initialized") {
    channelRegistry.handleEvent(event);
  } else {
    LOG.debug("Ignoring event for different provider", {
      eventType: event.type,
      eventAddress: event.address,
      ourAddress: providerAddress,
    });
  }
});

export async function startEventWatcher(): Promise<void> {
  await eventWatcher.start();
}

export function stopEventWatcher(): void {
  eventWatcher.stop();
}
