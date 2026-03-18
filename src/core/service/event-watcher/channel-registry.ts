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

const REGISTRY_KV_KEY = ["channel-registry", "channels"];

/**
 * In-memory registry of channels this PP is registered in.
 *
 * Populated by EventWatcher events, read by dashboard API endpoints.
 * The `configuredChannels` set represents which channels the operator
 * has chosen to actively serve (from instance config).
 *
 * State is persisted to Deno KV so restarts don't lose channel info.
 * On startup, the registry restores from KV first, then seeds any
 * configured channels that aren't already tracked.
 */
export class ChannelRegistry {
  private channels: Map<string, ChannelRecord> = new Map();
  private configuredChannels: Set<string>;
  private kv: Deno.Kv | null = null;

  constructor(configuredChannelIds: string[]) {
    this.configuredChannels = new Set(configuredChannelIds);
  }

  /**
   * Initialize the registry: restore from KV, then seed any configured
   * channels not already present. Must be called before use.
   */
  async initialize(): Promise<void> {
    await Deno.mkdir(".data", { recursive: true });
    this.kv = await Deno.openKv("./.data/memory-kvdb.db");

    // Restore persisted state
    const stored = await this.kv.get<ChannelRecord[]>(REGISTRY_KV_KEY);
    if (stored.value && stored.value.length > 0) {
      for (const record of stored.value) {
        this.channels.set(record.contractId, record);
      }
      LOG.info("ChannelRegistry restored from KV", {
        count: stored.value.length,
        channels: stored.value.map((r) => ({
          contractId: r.contractId,
          state: r.state,
        })),
      });
    }

    // Seed configured channels that aren't already tracked
    for (const contractId of this.configuredChannels) {
      if (!this.channels.has(contractId)) {
        this.channels.set(contractId, {
          contractId,
          state: "active",
          registeredAtLedger: 0,
        });
        LOG.info("Seeded configured channel as active", { contractId });
      }
    }

    await this.persist();
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
      case "contract_initialized":
        LOG.debug("Channel Auth contract initialized", {
          contractId: event.contractId,
          admin: event.address,
        });
        break;
    }
  }

  private async onProviderAdded(event: ChannelAuthEvent): Promise<void> {
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

    await this.persist();
  }

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

    LOG.info("Provider removed from channel", {
      contractId: event.contractId,
      ledger: event.ledger,
    });

    await this.persist();
  }

  /**
   * Persist current registry state to KV.
   */
  private async persist(): Promise<void> {
    if (!this.kv) return;
    try {
      await this.kv.set(REGISTRY_KV_KEY, this.getAll());
    } catch (error) {
      LOG.error("Failed to persist channel registry", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
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
  async activateChannel(contractId: string): Promise<void> {
    this.configuredChannels.add(contractId);
    const channel = this.channels.get(contractId);
    if (channel && channel.state === "pending") {
      channel.state = "active";
      await this.persist();
    }
  }

  /**
   * Mark a channel as no longer configured by the operator.
   */
  async deactivateChannel(contractId: string): Promise<void> {
    this.configuredChannels.delete(contractId);
    const channel = this.channels.get(contractId);
    if (channel && channel.state === "active") {
      channel.state = "pending";
      await this.persist();
    }
  }

  /**
   * Close the KV handle. Call on shutdown.
   */
  close(): void {
    if (this.kv) {
      this.kv.close();
      this.kv = null;
    }
  }
}
