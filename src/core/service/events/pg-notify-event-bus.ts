import type { Logger } from "@/utils/logger/index.ts";
import type { ProviderEvent } from "@/core/service/events/event.types.ts";

export type EventListener = (event: ProviderEvent) => void;

/**
 * Single Postgres channel used for the entire ProviderEvent taxonomy.
 * Receivers deserialize and dispatch by `kind`.
 */
export const PROVIDER_EVENTS_CHANNEL = "provider_events";

/**
 * Defensive cap below Postgres' 8000-byte NOTIFY payload limit. Emits whose
 * serialized JSON would exceed this are logged and dropped rather than
 * throwing into the caller's already-committed transaction.
 */
export const MAX_NOTIFY_PAYLOAD_BYTES = 7900;

/**
 * Fire-and-forget transport for cross-machine event publish. Production
 * wires this to `pgClient.notify(PROVIDER_EVENTS_CHANNEL, payload)` from
 * postgres-js; tests wire it to a direct PGlite NOTIFY against the same
 * in-process database used by the pgListener.
 */
export type NotifyFn = (payload: string) => Promise<unknown>;

/**
 * Cross-machine pub/sub bus. Public surface (`emit` + `subscribe`) matches the
 * old in-process EventBus byte-for-byte so callers and WS subscribers work
 * unchanged.
 *
 * Production path: `emit()` calls the wired NOTIFY transport with the
 * serialized event. A dedicated pgListener task (`pg-listener.ts`) holds a
 * separate LISTEN connection on every machine and republishes incoming
 * notifications via `publishLocal()`. Emit never publishes directly to the
 * local listener set — every event round-trips through Postgres so there is
 * a single delivery path to debug.
 *
 * Loopback fallback: when `setNotifier()` has not been called, `emit()`
 * publishes directly to the local listener set. Used during boot before the
 * NOTIFY transport is wired.
 */
export class PgNotifyEventBus {
  private listeners = new Set<EventListener>();
  private log: Logger;
  private notifier: NotifyFn | null = null;

  constructor(deps: { log: Logger }) {
    this.log = deps.log.scope("PgNotifyEventBus");
  }

  /**
   * Wire the NOTIFY transport. Once called, `emit()` stops publishing to
   * local listeners directly and round-trips every event through Postgres
   * so it reaches subscribers on every machine.
   */
  setNotifier(notifier: NotifyFn): void {
    this.notifier = notifier;
    this.log.event("NOTIFY transport wired");
  }

  subscribe(listener: EventListener): () => void {
    this.log.info("subscribe");
    this.listeners.add(listener);
    this.log.debug("listenerCount", this.listeners.size);
    return () => {
      this.log.info("unsubscribe");
      this.listeners.delete(listener);
    };
  }

  emit(event: ProviderEvent): void {
    this.log.info("emit");
    this.log.debug("kind", event.kind);
    if (!this.notifier) {
      this.log.event("loopback emit (NOTIFY transport not wired)");
      this.publishLocal(event);
      return;
    }
    const payload = JSON.stringify(event);
    if (payload.length >= MAX_NOTIFY_PAYLOAD_BYTES) {
      this.log.debug("kind", event.kind);
      this.log.debug("payloadBytes", payload.length);
      this.log.event("dropped oversize event (exceeds NOTIFY payload cap)");
      return;
    }
    // Fires `NOTIFY provider_events, <payload>` via the wired transport.
    this.notifier(payload).catch((error: unknown) => {
      this.log.error(error, "NOTIFY failed");
    });
  }

  /**
   * Drive local subscribers without re-triggering NOTIFY. Invoked by the
   * pgListener task on incoming notifications. Listener exceptions are
   * caught so a buggy subscriber cannot break the publish loop.
   */
  publishLocal(event: ProviderEvent): void {
    this.log.debug("kind", event.kind);
    this.log.debug("listenerCount", this.listeners.size);
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        this.log.error(error, "EventBus listener error");
      }
    }
  }

  listenerCount(): number {
    return this.listeners.size;
  }
}

let _eventBus: PgNotifyEventBus | null = null;

/**
 * Lazy singleton accessor. The first caller wires up the logger; subsequent
 * callers receive the same instance. main.ts must call this once before any
 * publisher/subscriber so the bus exists.
 */
export function getEventBus(deps: { log: Logger }): PgNotifyEventBus {
  if (!_eventBus) {
    _eventBus = new PgNotifyEventBus(deps);
  }
  return _eventBus;
}

/**
 * Test-only: clear the singleton so each test file gets a fresh bus.
 */
export function resetEventBusForTests(): void {
  _eventBus = null;
}
