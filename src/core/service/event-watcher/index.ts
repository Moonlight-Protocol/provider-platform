import { CHALLENGE_TTL, EVENT_WATCHER_INTERVAL_MS } from "@/config/env.ts";
import { EventWatcher } from "./event-watcher.process.ts";
import { ChannelRegistry } from "./channel-registry.ts";
import { setChallengeTtlMs } from "@/core/service/auth/dashboard-auth.ts";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { PpRepository } from "@/persistence/drizzle/repository/pp.repository.ts";
import { CouncilMembershipRepository } from "@/persistence/drizzle/repository/council-membership.repository.ts";
import { CouncilMembershipStatus } from "@/persistence/drizzle/entity/council-membership.entity.ts";
import { LOG } from "@/config/logger.ts";

// Wire env CHALLENGE_TTL (seconds) to dashboard auth (ms)
setChallengeTtlMs(CHALLENGE_TTL * 1000);

/**
 * Multi-PP event watching.
 *
 * Each PP watches the Channel Auth contract(s) of the council(s) it has joined.
 * Provider addresses and watchers are loaded from the DB on startup
 * and updated dynamically via addProviderAddress/removeProviderAddress.
 */

const registeredProviders = new Set<string>();
const activeWatchers = new Map<string, EventWatcher>(); // channelAuthId → watcher

export const channelRegistry = new ChannelRegistry([]);

const ppRepo = new PpRepository(drizzleClient);
const membershipRepo = new CouncilMembershipRepository(drizzleClient);

/**
 * Initialize event watchers for all active PPs and their council memberships.
 * Called once at startup.
 */
async function initFromDb(): Promise<void> {
  try {
    const pps = await ppRepo.listAll();
    for (const pp of pps) {
      registeredProviders.add(pp.publicKey);
    }

    // Find all active memberships to determine which councils to watch
    for (const pp of pps) {
      const membership = await membershipRepo.getCurrentForPp(pp.publicKey);
      if (
        membership?.status === CouncilMembershipStatus.ACTIVE &&
        membership.channelAuthId
      ) {
        await ensureWatcher(membership.channelAuthId);
      }
    }

    LOG.info("Event watchers initialized from DB", {
      providers: registeredProviders.size,
      watchers: activeWatchers.size,
    });
  } catch (err) {
    LOG.warn("Failed to initialize event watchers from DB", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function ensureWatcher(channelAuthId: string): Promise<void> {
  if (activeWatchers.has(channelAuthId)) return;

  const watcher = new EventWatcher({
    contractId: channelAuthId,
    intervalMs: EVENT_WATCHER_INTERVAL_MS,
  });
  watcher.onEvent(async (event) => {
    if (
      registeredProviders.has(event.address) ||
      event.type === "contract_initialized"
    ) {
      await channelRegistry.handleEvent(event);

      // When a registered PP is added on-chain, activate its membership
      if (
        event.type === "provider_added" &&
        registeredProviders.has(event.address)
      ) {
        await activateMembership(event.address, channelAuthId);
      }

      // When a registered PP is removed on-chain, update its membership
      if (
        event.type === "provider_removed" &&
        registeredProviders.has(event.address)
      ) {
        await deactivateMembership(event.address, channelAuthId);
      }
    } else {
      LOG.debug("Ignoring event for unregistered provider", {
        eventType: event.type,
        eventAddress: event.address,
        registeredCount: registeredProviders.size,
      });
    }
  });

  try {
    await watcher.start();
  } catch (err) {
    LOG.error("Failed to start event watcher", {
      channelAuthId,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  activeWatchers.set(channelAuthId, watcher);
  channelRegistry.addChannel(channelAuthId);
  LOG.info("Started event watcher for council", { channelAuthId });
}

async function activateMembership(
  ppPublicKey: string,
  channelAuthId: string,
): Promise<void> {
  try {
    const membership = await membershipRepo.getCurrentForPp(ppPublicKey);
    if (!membership || membership.status === CouncilMembershipStatus.ACTIVE) {
      return;
    }
    if (membership.channelAuthId !== channelAuthId) return;

    // Fetch council config from the council's public API
    let configJson: string | null = null;
    let councilName = membership.councilName;
    try {
      const res = await fetch(
        `${membership.councilUrl}/api/v1/public/council?councilId=${
          encodeURIComponent(channelAuthId)
        }`,
      );
      if (res.ok) {
        const { data } = await res.json();
        configJson = JSON.stringify(data);
        councilName = data.council?.name ?? councilName;
      }
    } catch { /* best effort */ }

    await membershipRepo.update(membership.id, {
      status: CouncilMembershipStatus.ACTIVE,
      configJson,
      councilName,
    });
    LOG.info("PP membership activated via on-chain event", {
      ppPublicKey,
      channelAuthId,
    });
  } catch (err) {
    LOG.error("Failed to activate membership from event", {
      ppPublicKey,
      channelAuthId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function deactivateMembership(
  ppPublicKey: string,
  channelAuthId: string,
): Promise<void> {
  try {
    const membership = await membershipRepo.getCurrentForPp(ppPublicKey);
    if (!membership || membership.status !== CouncilMembershipStatus.ACTIVE) {
      return;
    }
    if (membership.channelAuthId !== channelAuthId) return;

    await membershipRepo.update(membership.id, {
      status: CouncilMembershipStatus.REJECTED,
    });
    LOG.info("PP membership deactivated via on-chain event", {
      ppPublicKey,
      channelAuthId,
    });
  } catch (err) {
    LOG.error("Failed to deactivate membership from event", {
      ppPublicKey,
      channelAuthId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function addProviderAddress(publicKey: string): void {
  registeredProviders.add(publicKey);
  LOG.info("Registered provider address for event watching", { publicKey });
}

export function removeProviderAddress(publicKey: string): void {
  registeredProviders.delete(publicKey);
}

/** Add a council to watch (e.g., when a PP's membership becomes active). */
export function addCouncilWatcher(channelAuthId: string): void {
  ensureWatcher(channelAuthId).catch((err) => {
    LOG.error("Failed to add council watcher", {
      channelAuthId,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

export async function startEventWatcher(): Promise<void> {
  await initFromDb();
  if (activeWatchers.size === 0) {
    LOG.info("No active council memberships — no event watchers started");
  }
}

export async function stopEventWatcher(): Promise<void> {
  for (const [, watcher] of activeWatchers) {
    try {
      await watcher.stop();
    } catch { /* best effort */ }
  }
  activeWatchers.clear();
}
