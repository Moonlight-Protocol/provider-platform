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
 * Each poll runs two independent reads: a LIVE read from the tip (so new events
 * are processed within one interval) and, until history is caught up, one
 * bounded BACKFILL slice from the boot ledger forward. The live read is never
 * gated by backfill progress — a provider that joins right now is seen on the
 * next tick even if backfill has days of empty history still to walk.
 *
 * The watcher holds NO durable cursor: provider-platform reconstructs all
 * derived state by querying the council on boot (converge-by-query). Events are
 * a live delta on top of that baseline.
 *
 * Consumers register handlers via `onEvent()` and the watcher
 * dispatches parsed events as they arrive.
 */
export class EventWatcher {
  private timeoutId: number | null = null;
  private isRunning = false;
  // Two INDEPENDENT cursors, so "listen for new events" is never gated behind
  // "finish backfilling history":
  //   - liveLedger tracks the tip. Each poll reads from it forward, so a new
  //     event (e.g. provider_added) is caught within one interval regardless of
  //     how far back history goes. It starts at the current latest ledger.
  //   - backfillLedger walks history from the resolved boot ledger (oldest
  //     retained, or the clamped pin) up to backfillCeiling — the tip at boot —
  //     one bounded slice per poll. It NEVER blocks the live path. null once
  //     backfill is complete or unnecessary.
  private liveLedger: number | null = null;
  private backfillLedger: number | null = null;
  private backfillCeiling: number | null = null;
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
   * Returns the live cursor — the ledger the tip-following read has advanced to.
   */
  getLastLedger(): number | null {
    return this.liveLedger;
  }

  /**
   * Returns the backfill cursor, or null once history is caught up. Test/debug.
   */
  getBackfillLedger(): number | null {
    return this.backfillLedger;
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
   * Single poll cycle: a LIVE read from the tip, then (until caught up) one
   * bounded BACKFILL slice. The live read owns the health signal; backfill is
   * isolated so its failures never mark the watcher unhealthy or block the tip.
   */
  private poll(): Promise<void> {
    return withSpan("EventWatcher.poll", async (span) => {
      try {
        // First poll: resolve both cursors INSIDE the retry machinery so a
        // transient RPC blip retries next tick instead of killing the watcher.
        // Assign together — if either RPC call throws, neither is set.
        if (this.liveLedger === null) {
          const { sequence: tip } = await this.rpc.getLatestLedger();
          const backfillStart = await resolveBootStartLedger(
            this.rpc,
            this.startLedgerBlock,
          );
          // Live follows the tip; new events are caught within one interval.
          this.liveLedger = tip;
          // Backfill walks history up to where live took over. Nothing to walk
          // if the boot ledger is already at/after the tip.
          this.backfillCeiling = tip;
          this.backfillLedger = backfillStart >= tip ? null : backfillStart;
          this.log.debug("contractCount", this.contractIds.size);
          this.log.debug("liveLedger", this.liveLedger);
          this.log.debug("backfillLedger", this.backfillLedger);
          this.log.event("EventWatcher initialized live + backfill cursors");
        }

        // LIVE read — always from the tip, first, never gated by backfill.
        const { events, latestLedger } = await fetchChannelAuthEvents(
          this.rpc,
          this.getContractIds(),
          this.liveLedger,
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
        this.liveLedger = latestLedger + 1;
        this.lastPollOkAt = Date.now();
      } catch (error) {
        span.addEvent("poll_error", {
          "error.message": error instanceof Error
            ? error.message
            : String(error),
        });

        // The live cursor fell out of retention — the watcher was idle longer
        // than the RPC retains. Resume at the current tip next poll; the idle
        // gap is reconciled by boot convergence-by-query, and backfill still
        // covers history up to boot. (This does NOT skip fresh events: a live
        // event only ever lands at the tip we're about to re-resolve to.)
        if (isOutOfRetentionError(error)) {
          span.addEvent("live_out_of_retention_reset");
          this.log.event(
            "EventWatcher live cursor out of retention; resuming at tip",
          );
          this.liveLedger = null;
          return;
        }

        // Surface the failure (#10) via the health signal.
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
        return;
      }

      // BACKFILL — one bounded slice, only after a healthy live read. Isolated:
      // its errors are logged but never touch the live cursor or health signal.
      await this.pollBackfill();
    });
  }

  /**
   * Walk history one bounded getEvents slice forward, dispatching events below
   * the ceiling (the live path owns everything from the ceiling on). Completes
   * when the cursor reaches the ceiling. Out-of-retention re-clamps to oldest.
   */
  private async pollBackfill(): Promise<void> {
    if (this.backfillLedger === null || this.backfillCeiling === null) return;
    if (this.backfillLedger >= this.backfillCeiling) {
      this.backfillLedger = null;
      return;
    }
    try {
      const { events, latestLedger } = await fetchChannelAuthEvents(
        this.rpc,
        this.getContractIds(),
        this.backfillLedger,
        { log: this.log },
      );
      for (const event of events) {
        // Strictly below the ceiling — no double-dispatch at the seam.
        if (event.ledger < this.backfillCeiling) {
          await this.dispatch(event);
        }
      }
      this.backfillLedger = latestLedger + 1;
      if (this.backfillLedger >= this.backfillCeiling) {
        this.backfillLedger = null;
        this.log.event("EventWatcher backfill complete");
      }
    } catch (error) {
      if (isOutOfRetentionError(error)) {
        // The backfill start fell below the retained window; re-clamp to oldest
        // and keep walking forward. Never affects the live cursor.
        this.log.event(
          "EventWatcher backfill out of retention; re-clamping to oldest retained",
        );
        try {
          this.backfillLedger = await resolveBootStartLedger(
            this.rpc,
            this.startLedgerBlock,
          );
          if (
            this.backfillCeiling !== null &&
            this.backfillLedger >= this.backfillCeiling
          ) {
            this.backfillLedger = null;
          }
        } catch (reclampError) {
          this.log.error(reclampError, "EventWatcher backfill re-clamp failed");
        }
        return;
      }
      this.log.error(error, "EventWatcher backfill error", {
        traceId: currentTraceId(),
      });
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
