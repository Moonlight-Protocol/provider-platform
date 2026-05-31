import type { Logger } from "@/utils/logger/index.ts";
import type { ProviderEvent } from "@/core/service/events/event.types.ts";

export type EventListener = (event: ProviderEvent) => void;

/**
 * In-process pub/sub bus. Listeners are invoked synchronously; emit() never
 * throws — listener failures are caught and logged so a buggy subscriber
 * cannot break the emitting service.
 */
export class EventBus {
  private listeners = new Set<EventListener>();
  private log: Logger;

  constructor(deps: { log: Logger }) {
    this.log = deps.log.scope("EventBus");
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

let _eventBus: EventBus | null = null;

/**
 * Lazy singleton accessor. The first caller wires up the logger; subsequent
 * callers receive the same instance. main.ts must call this once before any
 * publisher/subscriber so the bus exists.
 */
export function getEventBus(deps: { log: Logger }): EventBus {
  if (!_eventBus) {
    _eventBus = new EventBus(deps);
  }
  return _eventBus;
}
