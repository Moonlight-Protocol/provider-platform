import type { Logger } from "@/utils/logger/index.ts";
import type { Server } from "stellar-sdk/rpc";
import { fetchChannelAuthEvents } from "./event-watcher.service.ts";
import type { ChannelAuthEvent } from "./event-watcher.types.ts";
import { currentTraceId, SpanStatusCode, withSpan } from "@/core/tracing.ts";
import { isOutOfRetentionError } from "./retention.ts";
import { resolveBootStartLedger } from "./start-ledger.ts";

export type EventHandler = (event: ChannelAuthEvent) => void | Promise<void>;

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
  private rpc: Server;
  private startLedgerBlock: number | null;
  private log: Logger;
  // Health signal (#10): the watcher runs in the background with no request to
  // surface failures on, so its last-success / last-error is tracked here and
  // exposed via getHealth() for the /health endpoint.
  private lastPollOkAt: number | null = null;
  private lastPollError: { at: number; message: string } | null = null;

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
   * Background-poll health for the /health endpoint. `healthy` is false once a
   * poll has errored more recently than the last success (or never succeeded
   * after an error).
   */
  getHealth(): {
    running: boolean;
    lastPollOkAt: number | null;
    lastPollError: { at: number; message: string } | null;
    healthy: boolean;
  } {
    const healthy = this.lastPollError === null ||
      (this.lastPollOkAt !== null &&
        this.lastPollOkAt >= this.lastPollError.at);
    return {
      running: this.isRunning,
      lastPollOkAt: this.lastPollOkAt,
      lastPollError: this.lastPollError,
      healthy,
    };
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
   * Starts the event watcher polling loop.
   */
  start(): Promise<void> {
    if (this.isRunning) {
      this.log.event("EventWatcher is already running");
      return Promise.resolve();
    }

    this.isRunning = true;

    // No persisted cursor: the boot start ledger (oldest available, or the
    // configured override) is resolved by the FIRST poll, not here. Resolving
    // it inside the poll loop means a transient RPC failure while resolving it
    // is caught and retried on the next tick — exactly like any poll error —
    // instead of rejecting start() and leaving the watcher permanently dead
    // for the life of the process. The cursor stays null until resolved.
    this.log.debug("contractCount", this.contractIds.size);
    this.log.event(
      "EventWatcher started; boot start ledger resolves on first poll",
    );

    // Start the self-scheduling loop
    this.scheduleNext();
    return Promise.resolve();
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
        // First poll with no resolved boot position: resolve it now, INSIDE
        // this try/catch + retry machinery. A transient failure here (e.g. the
        // getHealth RPC blipping) is caught below and retried on the next tick
        // rather than terminally killing the watcher. Boot-sync semantics are
        // unchanged: oldest available, or the pinned override — never "latest".
        if (this.lastLedger === null) {
          this.lastLedger = await resolveBootStartLedger(
            this.rpc,
            this.startLedgerBlock,
          );
          this.log.debug("contractCount", this.contractIds.size);
          this.log.debug("startLedger", this.lastLedger);
          this.log.event("EventWatcher resolved boot start ledger");
        }

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
        this.lastPollOkAt = Date.now();
      } catch (error) {
        span.addEvent("poll_error", {
          "error.message": error instanceof Error
            ? error.message
            : String(error),
        });

        // Out of retention: the cursor fell below the RPC's retained window
        // (e.g. it was held at a stale position while no contract was watched,
        // and the window slid past it). Reset it so the next poll re-resolves
        // to the oldest retained ledger and reads FORWARD from there. Never
        // jump to "latest" — that skips the gap, and the skipped gap can hold
        // the very events we exist to process (e.g. provider_added, which
        // activates a membership).
        if (isOutOfRetentionError(error)) {
          span.addEvent("out_of_retention_reset");
          this.log.event(
            "EventWatcher cursor out of retention; resetting to oldest retained",
          );
          this.lastLedger = null;
          return;
        }

        // Surface the failure (#10): the swallowing catch previously left the
        // span un-errored and no health signal. Mark it ERROR, record the
        // exception, and update the health state so /health can report it.
        this.lastPollError = {
          at: Date.now(),
          message: error instanceof Error ? error.message : String(error),
        };
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: this.lastPollError.message,
        });
        span.recordException(
          error instanceof Error ? error : new Error(String(error)),
        );
        this.log.error(error, "EventWatcher poll error", {
          traceId: currentTraceId(),
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
        this.log.debug("eventType", event.type);
        this.log.error(error, "EventWatcher handler error");
      }
    }
  }
}
