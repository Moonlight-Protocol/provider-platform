import type { Logger } from "@/utils/logger/index.ts";
import type { ChannelAuthEvent } from "./event-watcher.types.ts";

/**
 * Channel state as seen by this PP instance.
 *
 * - `active`: registered on-chain AND configured in this instance
 * - `pending`: registered on-chain but NOT yet configured
 * - `inactive`: was configured but no longer registered on-chain
 * - `disabled`: the council disabled this asset channel on-chain. Distinct from
 *   pending/inactive: the PP IS a member and serves it, but in withdraw-only
 *   mode (new deposits/sends rejected). Re-enable returns it to `active`.
 */
export type ChannelState = "active" | "pending" | "inactive" | "disabled";

export interface ChannelRecord {
  /** Channel Auth contract ID */
  contractId: string;
  /** Current state */
  state: ChannelState;
  /** Ledger at which the PP was registered */
  registeredAtLedger: number;
  /** Ledger at which the PP was removed (if applicable) */
  removedAtLedger?: number;
}

/**
 * In-memory registry of channels this PP is registered in.
 *
 * Populated by EventWatcher events, read by dashboard API endpoints.
 * The `configuredChannels` set represents which channels the operator
 * has chosen to actively serve (from instance config).
 *
 * State is NOT persisted: every record it holds is authoritatively
 * re-queryable (channel membership from this PP's own DB, asset-channel status
 * from the council via converge-by-query on boot), so the registry is rebuilt
 * from scratch on each start rather than restored from a durable store.
 */
export class ChannelRegistry {
  private channels: Map<string, ChannelRecord> = new Map();
  private configuredChannels: Set<string>;
  private log: Logger;

  constructor(configuredChannelIds: string[], deps: { log: Logger }) {
    this.configuredChannels = new Set(configuredChannelIds);
    this.log = deps.log.scope("ChannelRegistry");
  }

  /** Dynamically add a channel to track (e.g., when a PP joins a new council). */
  addChannel(contractId: string): void {
    this.log.info("addChannel");
    this.log.debug("contractId", contractId);
    this.configuredChannels.add(contractId);
    if (!this.channels.has(contractId)) {
      this.channels.set(contractId, {
        contractId,
        state: "active",
        registeredAtLedger: 0,
      });
      this.log.event("channel registered as active");
    } else {
      this.log.event("channel already tracked");
    }
  }

  /**
   * Handle a Channel Auth event and update registry state.
   */
  async handleEvent(event: ChannelAuthEvent): Promise<void> {
    switch (event.type) {
      case "provider_added":
        await this.onProviderAdded(event);
        break;
      case "provider_removed":
        await this.onProviderRemoved(event);
        break;
      case "channel_state_changed":
        await this.applyChannelState(
          event.channel ?? event.address,
          event.enabled ?? true,
          event.ledger,
        );
        break;
      case "contract_initialized":
        this.log.debug("contractId", event.contractId);
        this.log.debug("admin", event.address);
        this.log.event("Channel Auth contract initialized");
        break;
    }
  }

  /**
   * Apply the council's confirmed asset-channel lifecycle decision. Keyed by the
   * PRIVACY-CHANNEL contract id (the asset channel), distinct from the
   * channel-auth membership records. Driven by `channel_state_changed` events
   * (live deltas) and by convergence-from-query on boot / out-of-retention.
   *
   * `enabled=false` → `disabled` (withdraw-only, enforced at bundle accept).
   * `enabled=true` → `active` (full service resumes). Idempotent: re-applying
   * the same state is a no-op.
   */
  // deno-lint-ignore require-await -- async to preserve the awaited mutation contract
  async applyChannelState(
    channelContractId: string,
    enabled: boolean,
    ledger = 0,
  ): Promise<void> {
    this.log.info("applyChannelState");
    this.log.debug("channelContractId", channelContractId);
    this.log.debug("enabled", enabled);
    const nextState: ChannelState = enabled ? "active" : "disabled";

    const existing = this.channels.get(channelContractId);
    if (existing && existing.state === nextState) return;

    this.channels.set(channelContractId, {
      contractId: channelContractId,
      state: nextState,
      registeredAtLedger: existing?.registeredAtLedger ?? ledger,
      removedAtLedger: existing?.removedAtLedger,
    });
    this.log.debug("state", nextState);
    this.log.event(
      enabled ? "asset channel enabled" : "asset channel disabled",
    );
  }

  /**
   * Whether an asset channel is currently disabled (withdraw-only). Unknown
   * channels are treated as NOT disabled — the gate fails open to full service,
   * so only an explicit on-chain disable restricts a channel.
   */
  isDisabled(channelContractId: string): boolean {
    return this.channels.get(channelContractId)?.state === "disabled";
  }

  // deno-lint-ignore require-await -- async to preserve the awaited mutation contract
  private async onProviderAdded(event: ChannelAuthEvent): Promise<void> {
    const isConfigured = this.configuredChannels.has(event.contractId);
    const state: ChannelState = isConfigured ? "active" : "pending";

    this.channels.set(event.contractId, {
      contractId: event.contractId,
      state,
      registeredAtLedger: event.ledger,
    });

    this.log.debug("contractId", event.contractId);
    this.log.debug("state", state);
    this.log.debug("ledger", event.ledger);
    this.log.event("provider registered in channel");
  }

  // deno-lint-ignore require-await -- async to preserve the awaited mutation contract
  private async onProviderRemoved(event: ChannelAuthEvent): Promise<void> {
    const existing = this.channels.get(event.contractId);
    if (existing) {
      existing.state = "inactive";
      existing.removedAtLedger = event.ledger;
    } else {
      this.channels.set(event.contractId, {
        contractId: event.contractId,
        state: "inactive",
        registeredAtLedger: 0,
        removedAtLedger: event.ledger,
      });
    }

    this.log.debug("contractId", event.contractId);
    this.log.debug("ledger", event.ledger);
    this.log.event("provider removed from channel");
  }

  /**
   * Get all channels and their states.
   */
  getAll(): ChannelRecord[] {
    return Array.from(this.channels.values());
  }

  /**
   * Get a specific channel by contract ID.
   */
  get(contractId: string): ChannelRecord | undefined {
    return this.channels.get(contractId);
  }

  /**
   * Get channels filtered by state.
   */
  getByState(state: ChannelState): ChannelRecord[] {
    return this.getAll().filter((c) => c.state === state);
  }

  /**
   * Mark a channel as configured (operator activated it).
   */
  // deno-lint-ignore require-await -- async to preserve the awaited mutation contract
  async activateChannel(contractId: string): Promise<void> {
    this.log.info("activateChannel");
    this.log.debug("contractId", contractId);
    this.configuredChannels.add(contractId);
    const channel = this.channels.get(contractId);
    if (channel && channel.state === "pending") {
      channel.state = "active";
      this.log.event("channel transitioned to active");
    }
  }

  /**
   * Mark a channel as no longer configured by the operator.
   */
  // deno-lint-ignore require-await -- async to preserve the awaited mutation contract
  async deactivateChannel(contractId: string): Promise<void> {
    this.log.info("deactivateChannel");
    this.log.debug("contractId", contractId);
    this.configuredChannels.delete(contractId);
    const channel = this.channels.get(contractId);
    if (channel && channel.state === "active") {
      channel.state = "pending";
      this.log.event("channel transitioned to pending");
    }
  }
}
