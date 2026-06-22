import type { Logger } from "@/utils/logger/index.ts";
import type { Server } from "stellar-sdk/rpc";
import { fetchChannelAuthEvents } from "./event-watcher.service.ts";
import type { ChannelAuthEvent } from "./event-watcher.types.ts";
import { withSpan } from "@/core/tracing.ts";
import { recoverFromOutOfRetention } from "./retention.ts";
import { resolveBootStartLedger } from "./start-ledger.ts";

export type EventHandler = (event: ChannelAuthEvent) => void | Promise<void>;
export type ResyncHandler = () => void | Promise<void>;

/**
 * EventWatcher polls Stellar RPC for Channel Auth contract events
 * (provider_added, provider_removed, contract_initialized, channel_state_changed).
 *
 * A SINGLE watcher covers EVERY active council: it holds a set of channel-auth
 * contract IDs and polls them all in one batched getEvents call, then dispatches
 * each event tagged with the contract it came from. Membership changes mutate
 * this set in place (`addContract`/`removeContract`) — the watcher keeps running
 * rather than being created/destroyed per council, so boot spins up exactly one
 * poller regardless of how many councils are active.
 *
 * Uses a self-scheduling pattern (setTimeout after each poll completes)
 * to prevent concurrent polls when RPC is slow.
 *
 * The watcher holds NO durable cursor: provider-platform reconstructs all
 * derived state by querying the council on boot (converge-by-query), so a fresh
 * watcher simply syncs all available history forward from the resolved boot
 * ledger (see `resolveBootStartLedger`). Events are a live delta on top of that
 * baseline.
 *
 * Consumers register handlers via `onEvent()` and the watcher
 * dispatches parsed events as they arrive.
 */
export class EventWatcher {
  private timeoutId: number | null = null;
  private isRunning = false;
  private lastLedger: number | null = null;
  private contractIds: Set<string>;
  private intervalMs: number;
  private handlers: EventHandler[] = [];
  private resyncHandlers: ResyncHandler[] = [];
  private rpc: Server;
  private startLedgerBlock: number | null;
  private log: Logger;

  constructor(
    config: { contractIds: string[]; intervalMs?: number },
    deps: { log: Logger; rpc: Server; startLedgerBlock: number | null },
  ) {
    this.contractIds = new Set(config.contractIds);
    this.intervalMs = config.intervalMs ?? 30_000;
    this.rpc = deps.rpc;
    this.startLedgerBlock = deps.startLedgerBlock;
    this.log = deps.log.scope("EventWatcher");
  }

  /**
   * Add a channel-auth contract to the watched set (e.g. when a PP joins a new
   * council). Idempotent; the next poll picks it up — no new watcher is spun up.
   */
  addContract(contractId: string): void {
    if (this.contractIds.has(contractId)) return;
    this.contractIds.add(contractId);
    this.log.debug("contractId", contractId);
    this.log.debug("contractCount", this.contractIds.size);
    this.log.event("added contract to event watcher set");
  }

  /**
   * Remove a channel-auth contract from the watched set (e.g. when no active
   * membership references it anymore). Idempotent; the watcher keeps running.
   */
  removeContract(contractId: string): void {
    if (!this.contractIds.delete(contractId)) return;
    this.log.debug("contractId", contractId);
    this.log.debug("contractCount", this.contractIds.size);
    this.log.event("removed contract from event watcher set");
  }

  /** The contracts currently covered by this watcher. */
  getContractIds(): string[] {
    return Array.from(this.contractIds);
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

    // No persisted cursor: resolve the boot start ledger (oldest available, or
    // the configured override) and sync forward.
    this.lastLedger = await resolveBootStartLedger(
      this.rpc,
      this.startLedgerBlock,
    );
    this.log.debug("contractCount", this.contractIds.size);
    this.log.debug("startLedger", this.lastLedger);
    this.log.event("EventWatcher initialized boot start ledger");

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
        this.intervalMs,
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
          this.rpc,
          this.getContractIds(),
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

        // Advance cursor past the latest ledger we've seen (in memory only —
        // there is no durable cursor; converge-by-query is the recovery path).
        this.lastLedger = latestLedger + 1;
      } catch (error) {
        span.addEvent("poll_error", {
          "error.message": error instanceof Error
            ? error.message
            : String(error),
        });

        try {
          const recoveredCursor = await recoverFromOutOfRetention(
            error,
            () => this.rpc.getLatestLedger(),
            () => this.fireResync(),
            this.log,
          );
          if (recoveredCursor !== null) {
            span.addEvent("out_of_retention_recovery");
            this.lastLedger = recoveredCursor;
            return;
          }
        } catch (recoveryError) {
          this.log.error(
            recoveryError,
            "EventWatcher out-of-retention recovery failed",
          );
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
