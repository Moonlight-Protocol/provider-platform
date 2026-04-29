import { LOG } from "@/config/logger.ts";
import { NETWORK_RPC_SERVER } from "@/config/env.ts";
import { fetchChannelAuthEvents } from "./event-watcher.service.ts";
import type {
  ChannelAuthEvent,
  EventWatcherConfig,
} from "./event-watcher.types.ts";
import { withSpan } from "@/core/tracing.ts";

function cursorKvKey(contractId: string): Deno.KvKey {
  return ["event-watcher", contractId, "lastLedger"];
}

export type EventHandler = (event: ChannelAuthEvent) => void | Promise<void>;

/**
 * EventWatcher polls Stellar RPC for Channel Auth contract events
 * (provider_added, provider_removed, contract_initialized).
 *
 * Uses a self-scheduling pattern (setTimeout after each poll completes)
 * to prevent concurrent polls when RPC is slow.
 *
 * Persists the last processed ledger to Deno KV so restarts don't
 * lose event history.
 *
 * Consumers register handlers via `onEvent()` and the watcher
 * dispatches parsed events as they arrive.
 */
export class EventWatcher {
  private timeoutId: number | null = null;
  private isRunning = false;
  private lastLedger: number | null = null;
  private config: EventWatcherConfig;
  private handlers: EventHandler[] = [];
  private kv: Deno.Kv | null = null;

  constructor(config: { contractId: string; intervalMs?: number }) {
    this.config = {
      contractId: config.contractId,
      intervalMs: config.intervalMs ?? 30_000,
    };
  }

  /**
   * Register a handler that will be called for each new event.
   */
  onEvent(handler: EventHandler): void {
    this.handlers.push(handler);
  }

  /**
   * Starts the event watcher polling loop.
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      LOG.warn("EventWatcher is already running");
      return;
    }

    this.isRunning = true;

    // Open KV for cursor persistence
    await Deno.mkdir(".data", { recursive: true });
    this.kv = await Deno.openKv("./.data/memory-kvdb.db");

    // Restore cursor from KV, or fall back to current network ledger
    const stored = await this.kv.get<number>(
      cursorKvKey(this.config.contractId),
    );
    if (stored.value !== null) {
      this.lastLedger = stored.value;
      LOG.info("EventWatcher restored cursor from KV", {
        contractId: this.config.contractId,
        startLedger: this.lastLedger,
      });
    } else {
      const latestLedger = await NETWORK_RPC_SERVER.getLatestLedger();
      this.lastLedger = latestLedger.sequence;
      LOG.info("EventWatcher initialized from network (no saved cursor)", {
        contractId: this.config.contractId,
        startLedger: this.lastLedger,
      });
    }

    // Start the self-scheduling loop
    this.scheduleNext();
  }

  /**
   * Stops the event watcher polling loop.
   */
  stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;
    if (this.timeoutId !== null) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    if (this.kv) {
      this.kv.close();
      this.kv = null;
    }
    LOG.info("EventWatcher stopped");
  }

  /**
   * Returns the last processed ledger sequence.
   */
  getLastLedger(): number | null {
    return this.lastLedger;
  }

  /**
   * Self-scheduling: poll, then schedule the next poll after completion.
   * Prevents concurrent polls when RPC is slow.
   */
  private async scheduleNext(): Promise<void> {
    await this.poll();
    if (this.isRunning) {
      this.timeoutId = setTimeout(
        () => this.scheduleNext(),
        this.config.intervalMs,
      ) as unknown as number;
    }
  }

  /**
   * Single poll cycle: fetch events since lastLedger, dispatch to handlers.
   */
  private poll(): Promise<void> {
    return withSpan("EventWatcher.poll", async (span) => {
      try {
        if (this.lastLedger === null) return;

        const { events, latestLedger } = await fetchChannelAuthEvents(
          NETWORK_RPC_SERVER,
          this.config.contractId,
          this.lastLedger,
        );

        if (events.length > 0) {
          span.addEvent("dispatching_events", {
            "events.count": events.length,
          });
          LOG.info(`EventWatcher found ${events.length} new event(s)`, {
            types: events.map((e) => e.type).join(", "),
          });

          for (const event of events) {
            await this.dispatch(event);
          }
        }

        // Advance cursor past the latest ledger we've seen
        this.lastLedger = latestLedger + 1;

        // Persist cursor to KV
        if (this.kv) {
          await this.kv.set(
            cursorKvKey(this.config.contractId),
            this.lastLedger,
          );
        }
      } catch (error) {
        span.addEvent("poll_error", {
          "error.message": error instanceof Error
            ? error.message
            : String(error),
        });
        LOG.error("EventWatcher poll error", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  /**
   * Dispatches a single event to all registered handlers.
   */
  private async dispatch(event: ChannelAuthEvent): Promise<void> {
    for (const handler of this.handlers) {
      try {
        await handler(event);
      } catch (error) {
        LOG.error("EventWatcher handler error", {
          eventType: event.type,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}
