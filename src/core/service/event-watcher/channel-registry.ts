import { LOG } from "@/config/logger.ts";
import type { ChannelAuthEvent } from "./event-watcher.types.ts";

/**
 * Channel state as seen by this PP instance.
 *
 * - `active`: registered on-chain AND configured in this instance
 * - `pending`: registered on-chain but NOT yet configured
 * - `inactive`: was configured but no longer registered on-chain
 */
export type ChannelState = "active" | "pending" | "inactive";

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
 */
export class ChannelRegistry {
  private channels: Map<string, ChannelRecord> = new Map();
  private configuredChannels: Set<string>;

  constructor(configuredChannelIds: string[]) {
    this.configuredChannels = new Set(configuredChannelIds);
  }

  /**
   * Handle a Channel Auth event and update registry state.
   */
  handleEvent(event: ChannelAuthEvent): void {
    switch (event.type) {
      case "provider_added":
        this.onProviderAdded(event);
        break;
      case "provider_removed":
        this.onProviderRemoved(event);
        break;
      case "contract_initialized":
        // Not directly actionable for the registry
        LOG.debug("Channel Auth contract initialized", {
          contractId: event.contractId,
          admin: event.address,
        });
        break;
    }
  }

  private onProviderAdded(event: ChannelAuthEvent): void {
    const isConfigured = this.configuredChannels.has(event.contractId);
    const state: ChannelState = isConfigured ? "active" : "pending";

    this.channels.set(event.contractId, {
      contractId: event.contractId,
      state,
      registeredAtLedger: event.ledger,
    });

    LOG.info("Provider registered in channel", {
      contractId: event.contractId,
      state,
      ledger: event.ledger,
    });
  }

  private onProviderRemoved(event: ChannelAuthEvent): void {
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

    LOG.info("Provider removed from channel", {
      contractId: event.contractId,
      ledger: event.ledger,
    });
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
  activateChannel(contractId: string): void {
    this.configuredChannels.add(contractId);
    const channel = this.channels.get(contractId);
    if (channel && channel.state === "pending") {
      channel.state = "active";
    }
  }

  /**
   * Mark a channel as no longer configured by the operator.
   */
  deactivateChannel(contractId: string): void {
    this.configuredChannels.delete(contractId);
    const channel = this.channels.get(contractId);
    if (channel && channel.state === "active") {
      channel.state = "pending";
    }
  }
}
