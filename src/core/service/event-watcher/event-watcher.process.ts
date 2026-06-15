import type { Logger } from "@/utils/logger/index.ts";
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
export type ResyncHandler = () => void | Promise<void>;

/**
 * Detect the Stellar RPC "startLedger out of retention" condition. When the
 * persisted cursor predates the RPC's retention window, getEvents fails and we
 * must reset the cursor and reconcile state via a council query instead.
 */
function isOutOfRetentionError(error: unknown): boolean {
  const msg = (error instanceof Error ? error.message : String(error))
    .toLowerCase();
  return (
    msg.includes("startledger") ||
    (msg.includes("ledger") &&
      (msg.includes("retention") ||
        msg.includes("oldest") ||
        msg.includes("before") ||
        msg.includes("out of range") ||
        msg.includes("not within")))
  );
}

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
  private resyncHandlers: ResyncHandler[] = [];
  private kv: Deno.Kv | null = null;
  private log: Logger;

  constructor(
    config: { contractId: string; intervalMs?: number },
    deps: { log: Logger },
  ) {
    this.config = {
      contractId: config.contractId,
      intervalMs: config.intervalMs ?? 30_000,
    };
    this.log = deps.log.scope("EventWatcher");
  }

  /**
   * Register a handler that will be called for each new event.
   */
  onEvent(handler: EventHandler): void {
    this.handlers.push(handler);
  }

  /**
   * Register a handler invoked when the watcher recovers from an out-of-retention
   * cursor — the cue to reconcile state via a council query.
   */
  onResync(handler: ResyncHandler): void {
    this.resyncHandlers.push(handler);
  }

  /**
   * Starts the event watcher polling loop.
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.log.event("EventWatcher is already running");
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
      this.log.debug("contractId", this.config.contractId);
      this.log.debug("startLedger", this.lastLedger);
      this.log.event("EventWatcher restored cursor from KV");
    } else {
      const latestLedger = await NETWORK_RPC_SERVER.getLatestLedger();
      this.lastLedger = latestLedger.sequence;
      this.log.debug("contractId", this.config.contractId);
      this.log.debug("startLedger", this.lastLedger);
      this.log.event("EventWatcher initialized from network (no saved cursor)");
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
    this.log.event("EventWatcher stopped");
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
    this.log.info("scheduleNext");
    await this.poll();
    if (this.isRunning) {
      this.timeoutId = setTimeout(
        () => this.scheduleNext(),
        this.config.intervalMs,
      ) as unknown as number;
      this.log.event("next poll scheduled");
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
          { log: this.log },
        );

        if (events.length > 0) {
          span.addEvent("dispatching_events", {
            "events.count": events.length,
          });
          this.log.debug("count", events.length);
          this.log.debug("types", events.map((e) => e.type).join(", "));
          this.log.event("EventWatcher found new events");

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

        if (isOutOfRetentionError(error)) {
          // Cursor predates RPC retention: events between the cursor and the
          // current ledger are unrecoverable from RPC. Jump the cursor to the
          // latest ledger and reconcile missed state via a council query.
          span.addEvent("out_of_retention_recovery");
          this.log.event("EventWatcher cursor out of retention; recovering");
          try {
            const latest = await NETWORK_RPC_SERVER.getLatestLedger();
            this.lastLedger = latest.sequence + 1;
            if (this.kv) {
              await this.kv.set(
                cursorKvKey(this.config.contractId),
                this.lastLedger,
              );
            }
            await this.fireResync();
          } catch (recoveryError) {
            this.log.error(
              recoveryError,
              "EventWatcher out-of-retention recovery failed",
            );
          }
          return;
        }

        this.log.error(error, "EventWatcher poll error");
      }
    });
  }

  /**
   * Invoke all registered resync handlers (best-effort, isolated failures).
   */
  private async fireResync(): Promise<void> {
    for (const handler of this.resyncHandlers) {
      try {
        await handler();
      } catch (error) {
        this.log.error(error, "EventWatcher resync handler error");
      }
    }
  }

  /**
   * Dispatches a single event to all registered handlers.
   */
  private async dispatch(event: ChannelAuthEvent): Promise<void> {
    for (const handler of this.handlers) {
      try {
        await handler(event);
      } catch (error) {
        this.log.debug("eventType", event.type);
        this.log.error(error, "EventWatcher handler error");
      }
    }
  }
}
