/**
 * Channel Auth contract event types.
 *
 * These correspond to the events emitted by the Channel Auth contract:
 * - `contract_initialized` — emitted when the contract is deployed
 * - `provider_added` — emitted when a provider is registered
 * - `provider_removed` — emitted when a provider is deregistered
 * - `channel_state_changed` — emitted when an asset channel is enabled/disabled
 */
export type ChannelAuthEventType =
  | "contract_initialized"
  | "provider_added"
  | "provider_removed"
  | "channel_state_changed";

export interface ChannelAuthEvent {
  type: ChannelAuthEventType;
  /** The address in the event topic (provider or admin); for
   * channel_state_changed this mirrors the channel (privacy-channel) id. */
  address: string;
  /** Ledger sequence where the event was emitted */
  ledger: number;
  /** Contract ID that emitted the event (the channel-auth / council contract) */
  contractId: string;
  /** channel_state_changed only: the privacy-channel contract id. */
  channel?: string;
  /** channel_state_changed only: the asset (token) contract id. */
  asset?: string;
  /** channel_state_changed only: true=enabled/re-enabled, false=disabled. */
  enabled?: boolean;
}

export interface EventWatcherConfig {
  /** Channel Auth contract IDs to watch (one watcher covers every active
   * council's contract via a single batched poll). */
  contractIds: string[];
  /** RPC polling interval in milliseconds */
  intervalMs: number;
}
