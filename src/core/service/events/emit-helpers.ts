import { LOG } from "@/config/logger.ts";
import { eventBus } from "@/core/service/events/event-bus.ts";
import {
  resolveScopeForPp,
  resolveScopesForChannel,
} from "@/core/service/events/scope-resolver.ts";
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
