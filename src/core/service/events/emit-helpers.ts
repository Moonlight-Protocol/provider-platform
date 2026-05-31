import { inArray } from "drizzle-orm";
import type { Logger } from "@/utils/logger/index.ts";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { getEventBus } from "@/core/service/events/event-bus.ts";
import {
  resolveAllPpScopes,
  resolveScopeForPp,
  resolveScopesForChannel,
} from "@/core/service/events/scope-resolver.ts";
import { operationsBundle } from "@/persistence/drizzle/entity/operations-bundle.entity.ts";
import type {
  EventScope,
  ProviderEvent,
} from "@/core/service/events/event.types.ts";

/**
 * Resolves the active PP scopes for the given channel and emits one event
 * per scope. Errors during resolution are logged, never thrown, so emission
 * paths cannot crash the calling service.
 */
export async function emitForChannel(
  channelContractId: string,
  build: (scope: EventScope) => ProviderEvent,
  deps: { log: Logger },
): Promise<void> {
  if (!channelContractId) return;
  const log = deps.log.scope("emitForChannel");
  log.info("emitForChannel");
  log.debug("channelContractId", channelContractId);
  try {
    log.event("resolving scopes for channel");
    const scopes = await resolveScopesForChannel(channelContractId);
    for (const scope of scopes) {
      getEventBus(deps).emit(build(scope));
    }
  } catch (error) {
    log.error(error, "emitForChannel failed");
  }
}

/**
 * Resolves the scope for a known PP and emits a single event.
 */
export async function emitForPp(
  ppPublicKey: string,
  build: (scope: EventScope) => ProviderEvent,
  deps: { log: Logger },
): Promise<void> {
  if (!ppPublicKey) return;
  const log = deps.log.scope("emitForPp");
  log.info("emitForPp");
  log.debug("ppPublicKey", ppPublicKey);
  try {
    log.event("resolving scope for PP");
    const scope = await resolveScopeForPp(ppPublicKey);
    if (!scope) return;
    getEventBus(deps).emit(build(scope));
  } catch (error) {
    log.error(error, "emitForPp failed");
  }
}

/**
 * Looks up the distinct PPs that own the given bundle IDs and emits one event
 * per PP scope. Used by bundle-success paths so dashboards only see events
 * for bundles that actually belong to them.
 */
export async function emitForBundles(
  bundleIds: string[],
  build: (scope: EventScope) => ProviderEvent,
  deps: { log: Logger },
): Promise<void> {
  if (!bundleIds.length) return;
  const log = deps.log.scope("emitForBundles");
  log.info("emitForBundles");
  log.debug("bundleIdCount", bundleIds.length);
  try {
    log.event("loading distinct PPs that own these bundles");
    const rows = await drizzleClient
      .select({ ppPublicKey: operationsBundle.ppPublicKey })
      .from(operationsBundle)
      .where(inArray(operationsBundle.id, bundleIds));
    const distinct = new Set<string>();
    for (const r of rows) {
      if (r.ppPublicKey) distinct.add(r.ppPublicKey);
    }
    log.debug("distinctPpCount", distinct.size);
    for (const pk of distinct) {
      const scope = await resolveScopeForPp(pk);
      if (!scope) continue;
      getEventBus(deps).emit(build(scope));
    }
  } catch (error) {
    log.error(error, "emitForBundles failed");
  }
}

/**
 * Fans an event out to every PP on this instance. Used for FAILED / EXPIRED
 * bundle events so all operators see network-wide failures regardless of which
 * PP owns the bundle.
 */
export async function emitForAllPps(
  build: (scope: EventScope) => ProviderEvent,
  deps: { log: Logger },
): Promise<void> {
  const log = deps.log.scope("emitForAllPps");
  log.info("emitForAllPps");
  try {
    log.event("resolving all PP scopes");
    const scopes = await resolveAllPpScopes();
    for (const scope of scopes) {
      getEventBus(deps).emit(build(scope));
    }
  } catch (error) {
    log.error(error, "emitForAllPps failed");
  }
}
