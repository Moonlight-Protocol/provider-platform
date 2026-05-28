import { inArray } from "drizzle-orm";
import { LOG } from "@/config/logger.ts";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { eventBus } from "@/core/service/events/event-bus.ts";
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
 * per scope (so single-PP-bound WebSocket subscribers see only their own
 * events). The builder is called once per scope and must return a fully
 * typed ProviderEvent. Errors during resolution are logged, never thrown,
 * so emission paths cannot crash the calling service.
 */
export async function emitForChannel(
  channelContractId: string,
  build: (scope: EventScope) => ProviderEvent,
): Promise<void> {
  if (!channelContractId) return;
  try {
    const scopes = await resolveScopesForChannel(channelContractId);
    for (const scope of scopes) {
      eventBus.emit(build(scope));
    }
  } catch (error) {
    LOG.error("emitForChannel failed", {
      channelContractId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Resolves the scope for a known PP and emits a single event. Used for
 * channel.provider_* events where the watcher already knows which PP changed.
 */
export async function emitForPp(
  ppPublicKey: string,
  build: (scope: EventScope) => ProviderEvent,
): Promise<void> {
  if (!ppPublicKey) return;
  try {
    const scope = await resolveScopeForPp(ppPublicKey);
    if (!scope) return;
    eventBus.emit(build(scope));
  } catch (error) {
    LOG.error("emitForPp failed", {
      ppPublicKey,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Looks up the distinct PPs that own the given bundle IDs and emits one event
 * per PP scope. Used by bundle-success paths (mempool.bundle_added, executor.
 * transaction_submitted, verifier.bundle_completed) so dashboards only see
 * events for bundles that actually belong to them — and not every PP that
 * happens to share a channel.
 */
export async function emitForBundles(
  bundleIds: string[],
  build: (scope: EventScope) => ProviderEvent,
): Promise<void> {
  if (!bundleIds.length) return;
  try {
    const rows = await drizzleClient
      .select({ ppPublicKey: operationsBundle.ppPublicKey })
      .from(operationsBundle)
      .where(inArray(operationsBundle.id, bundleIds));
    const distinct = new Set<string>();
    for (const r of rows) {
      if (r.ppPublicKey) distinct.add(r.ppPublicKey);
    }
    for (const pk of distinct) {
      const scope = await resolveScopeForPp(pk);
      if (!scope) continue;
      eventBus.emit(build(scope));
    }
  } catch (error) {
    LOG.error("emitForBundles failed", {
      bundleIds,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Fans an event out to every PP on this instance. Used for FAILED / EXPIRED
 * bundle events so all operators see network-wide failures regardless of which
 * PP owns the bundle.
 */
export async function emitForAllPps(
  build: (scope: EventScope) => ProviderEvent,
): Promise<void> {
  try {
    const scopes = await resolveAllPpScopes();
    for (const scope of scopes) {
      eventBus.emit(build(scope));
    }
  } catch (error) {
    LOG.error("emitForAllPps failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
