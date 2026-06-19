import {
  BOOT_SYNC_START_LEDGER_BLOCK,
  CHALLENGE_TTL,
  EVENT_WATCHER_INTERVAL_MS,
  NETWORK_RPC_SERVER,
} from "@/config/env.ts";
import { EventWatcher } from "./event-watcher.process.ts";
import { ChannelRegistry } from "./channel-registry.ts";
import {
  fetchCouncilConfig,
  reconcileChannelStatuses,
} from "./channel-convergence.ts";
import { setChallengeTtlMs } from "@/core/service/auth/dashboard-auth.ts";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { PpRepository } from "@/persistence/drizzle/repository/pp.repository.ts";
import { CouncilMembershipRepository } from "@/persistence/drizzle/repository/council-membership.repository.ts";
import { CouncilMembershipStatus } from "@/persistence/drizzle/entity/council-membership.entity.ts";
import type { Logger } from "@/utils/logger/index.ts";
import { emitForPp } from "@/core/service/events/emit-helpers.ts";

// Wire env CHALLENGE_TTL (seconds) to dashboard auth (ms)
setChallengeTtlMs(CHALLENGE_TTL * 1000);

const registeredProviders = new Set<string>();
const activeWatchers = new Map<string, EventWatcher>();

export let channelRegistry: ChannelRegistry;
let watcherLog: Logger | null = null;

const ppRepo = new PpRepository(drizzleClient);
const membershipRepo = new CouncilMembershipRepository(drizzleClient);

async function initFromDb(): Promise<void> {
  const log = watcherLog!.scope("eventWatcher");
  try {
    const pps = await ppRepo.listAll();
    for (const pp of pps) {
      registeredProviders.add(pp.publicKey);
    }

    for (const pp of pps) {
      const membership = await membershipRepo.getCurrentForPp(pp.publicKey);
      if (
        membership?.status === CouncilMembershipStatus.ACTIVE &&
        membership.channelAuthId
      ) {
        await ensureWatcher(membership.channelAuthId);
      }
    }

    log.debug("providers", registeredProviders.size);
    log.debug("watchers", activeWatchers.size);
    log.event("event watchers initialized from DB");
  } catch (err) {
    log.error(err, "failed to initialize event watchers from DB");
  }
}

async function ensureWatcher(channelAuthId: string): Promise<void> {
  const log = watcherLog!.scope("ensureWatcher");
  log.info("ensureWatcher");
  log.debug("channelAuthId", channelAuthId);
  if (activeWatchers.has(channelAuthId)) {
    log.event("watcher already active");
    return;
  }

  const watcher = new EventWatcher({
    contractId: channelAuthId,
    intervalMs: EVENT_WATCHER_INTERVAL_MS,
  }, {
    log: watcherLog!,
    rpc: NETWORK_RPC_SERVER,
    startLedgerBlock: BOOT_SYNC_START_LEDGER_BLOCK,
  });

  // Re-query the council and reconcile asset-channel statuses when the event
  // cursor falls out of Stellar RPC retention (events may have been missed; the
  // query can't be). This is the can't-miss convergence path.
  watcher.onResync(async () => {
    await convergeChannelStatusesForCouncil(channelAuthId);
  });

  watcher.onEvent(async (event) => {
    // Asset-channel lifecycle events are council-scoped, not provider-scoped —
    // handle them regardless of which provider address appears, so a disable
    // immediately drives the withdraw-only gate.
    if (event.type === "channel_state_changed") {
      await channelRegistry.handleEvent(event);
      return;
    }

    if (
      registeredProviders.has(event.address) ||
      event.type === "contract_initialized"
    ) {
      await channelRegistry.handleEvent(event);

      if (
        event.type === "provider_added" &&
        registeredProviders.has(event.address)
      ) {
        await activateMembership(event.address, channelAuthId);
        await emitForPp(event.address, (scope) => ({
          kind: "channel.provider_added",
          ts: Date.now(),
          scope,
          payload: { channelContractId: channelAuthId },
        }), { log: watcherLog! });
      }

      if (
        event.type === "provider_removed" &&
        registeredProviders.has(event.address)
      ) {
        await deactivateMembership(event.address, channelAuthId);
        await emitForPp(event.address, (scope) => ({
          kind: "channel.provider_removed",
          ts: Date.now(),
          scope,
          payload: { channelContractId: channelAuthId },
        }), { log: watcherLog! });
      }
    } else {
      log.debug("eventType", event.type);
      log.debug("eventAddress", event.address);
      log.debug("registeredCount", registeredProviders.size);
      log.event("ignoring event for unregistered provider");
    }
  });

  try {
    await watcher.start();
  } catch (err) {
    log.debug("channelAuthId", channelAuthId);
    log.error(err, "failed to start event watcher");
    return;
  }

  activeWatchers.set(channelAuthId, watcher);
  channelRegistry.addChannel(channelAuthId);
  log.debug("channelAuthId", channelAuthId);
  log.event("started event watcher for council");
}

/**
 * Boot convergence: query every active membership's council once and reconcile
 * asset-channel statuses. Events are the live delta; this query is the
 * can't-miss baseline so a disable that happened while we were down is applied.
 */
async function convergeChannelStatusesOnBoot(): Promise<void> {
  const log = watcherLog!.scope("convergeChannelStatuses");
  const seen = new Set<string>();
  try {
    const pps = await ppRepo.listAll();
    for (const pp of pps) {
      const membership = await membershipRepo.getActiveForPp(pp.publicKey);
      if (!membership?.channelAuthId) continue;
      const key = `${membership.councilUrl}|${membership.channelAuthId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const data = await fetchCouncilConfig(
        membership.councilUrl,
        membership.channelAuthId,
      );
      if (data) await reconcileChannelStatuses(channelRegistry, data);
    }
    log.debug("councils", seen.size);
    log.event("asset-channel statuses converged from council queries");
  } catch (err) {
    log.error(err, "failed to converge channel statuses on boot");
  }
}

/**
 * Re-query a single council and reconcile its asset-channel statuses. Used on
 * out-of-retention recovery for that council's watcher.
 */
async function convergeChannelStatusesForCouncil(
  channelAuthId: string,
): Promise<void> {
  const log = watcherLog!.scope("convergeChannelStatuses");
  try {
    const pps = await ppRepo.listAll();
    for (const pp of pps) {
      const membership = await membershipRepo.getActiveForPp(pp.publicKey);
      if (membership?.channelAuthId !== channelAuthId) continue;
      const data = await fetchCouncilConfig(
        membership.councilUrl,
        channelAuthId,
      );
      if (data) {
        await reconcileChannelStatuses(channelRegistry, data);
        log.debug("channelAuthId", channelAuthId);
        log.event("asset-channel statuses re-queried after out-of-retention");
      }
      return;
    }
  } catch (err) {
    log.error(err, "failed to converge channel statuses for council");
  }
}

async function activateMembership(
  ppPublicKey: string,
  channelAuthId: string,
): Promise<void> {
  const log = watcherLog!.scope("activateMembership");
  log.info("activateMembership");
  log.debug("ppPublicKey", ppPublicKey);
  log.debug("channelAuthId", channelAuthId);
  try {
    const membership = await membershipRepo.getCurrentForPp(ppPublicKey);
    if (!membership || membership.status === CouncilMembershipStatus.ACTIVE) {
      return;
    }
    if (membership.channelAuthId !== channelAuthId) return;

    let configJson: string | null = null;
    let councilName = membership.councilName;
    const data = await fetchCouncilConfig(membership.councilUrl, channelAuthId);
    if (data) {
      configJson = JSON.stringify(data);
      councilName = data.council?.name ?? councilName;
      // Seed asset-channel statuses so the withdraw-only gate is correct from
      // the moment membership activates (convergence-by-query).
      await reconcileChannelStatuses(channelRegistry, data);
    }

    await membershipRepo.update(membership.id, {
      status: CouncilMembershipStatus.ACTIVE,
      configJson,
      councilName,
    });
    log.debug("ppPublicKey", ppPublicKey);
    log.debug("channelAuthId", channelAuthId);
    log.event("PP membership activated via on-chain event");
  } catch (err) {
    log.debug("ppPublicKey", ppPublicKey);
    log.debug("channelAuthId", channelAuthId);
    log.error(err, "failed to activate membership from event");
  }
}

async function deactivateMembership(
  ppPublicKey: string,
  channelAuthId: string,
): Promise<void> {
  const log = watcherLog!.scope("deactivateMembership");
  log.info("deactivateMembership");
  log.debug("ppPublicKey", ppPublicKey);
  log.debug("channelAuthId", channelAuthId);
  try {
    const membership = await membershipRepo.getCurrentForPp(ppPublicKey);
    if (!membership || membership.status !== CouncilMembershipStatus.ACTIVE) {
      return;
    }
    if (membership.channelAuthId !== channelAuthId) return;

    await membershipRepo.update(membership.id, {
      status: CouncilMembershipStatus.REJECTED,
    });
    log.debug("ppPublicKey", ppPublicKey);
    log.debug("channelAuthId", channelAuthId);
    log.event("PP membership deactivated via on-chain event");
  } catch (err) {
    log.debug("ppPublicKey", ppPublicKey);
    log.debug("channelAuthId", channelAuthId);
    log.error(err, "failed to deactivate membership from event");
  }
}

export function addProviderAddress(publicKey: string): void {
  if (watcherLog) {
    const log = watcherLog.scope("addProviderAddress");
    log.info("addProviderAddress");
    log.debug("publicKey", publicKey);
    log.event("registered provider address for event watching");
  }
  registeredProviders.add(publicKey);
}

export function removeProviderAddress(publicKey: string): void {
  if (watcherLog) {
    const log = watcherLog.scope("removeProviderAddress");
    log.info("removeProviderAddress");
    log.debug("publicKey", publicKey);
  }
  registeredProviders.delete(publicKey);
}

export function addCouncilWatcher(channelAuthId: string): void {
  if (watcherLog) {
    const log = watcherLog.scope("addCouncilWatcher");
    log.info("addCouncilWatcher");
    log.debug("channelAuthId", channelAuthId);
    log.event("scheduling watcher for council");
  }
  ensureWatcher(channelAuthId).catch((err) => {
    if (watcherLog) {
      const log = watcherLog.scope("addCouncilWatcher");
      log.error(err, "failed to add council watcher");
    }
  });
}

export async function startEventWatcher(deps: { log: Logger }): Promise<void> {
  watcherLog = deps.log;
  if (!channelRegistry) {
    channelRegistry = new ChannelRegistry([], { log: watcherLog });
  }
  const log = watcherLog.scope("startEventWatcher");
  log.info("startEventWatcher");
  await initFromDb();
  // Converge asset-channel statuses by querying the council(s) — applies any
  // disable/enable that happened while this provider was down.
  await convergeChannelStatusesOnBoot();
  if (activeWatchers.size === 0) {
    log.event("no active council memberships — no event watchers started");
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
