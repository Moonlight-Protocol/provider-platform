import { LOG } from "@/config/logger.ts";
import type { ProviderEvent } from "@/core/service/events/event.types.ts";

export type EventListener = (event: ProviderEvent) => void;

/**
 * In-process pub/sub bus. Listeners are invoked synchronously; emit() never
 * throws — listener failures are caught and logged so a buggy subscriber
 * cannot break the emitting service.
 */
export class EventBus {
  private listeners = new Set<EventListener>();

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: ProviderEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        LOG.error("EventBus listener error", {
          kind: event.kind,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  listenerCount(): number {
    return this.listeners.size;
  }
}

export const eventBus = new EventBus();
