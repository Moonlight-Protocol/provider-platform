/**
 * Channel Auth contract event types.
 *
 * These correspond to the events emitted by the Channel Auth contract:
 * - `contract_initialized` — emitted when the contract is deployed
 * - `provider_added` — emitted when a provider is registered
 * - `provider_removed` — emitted when a provider is deregistered
 */
export type ChannelAuthEventType =
  | "contract_initialized"
  | "provider_added"
  | "provider_removed";

export interface ChannelAuthEvent {
  type: ChannelAuthEventType;
  /** The address in the event topic (provider or admin) */
  address: string;
  /** Ledger sequence where the event was emitted */
  ledger: number;
  /** Contract ID that emitted the event */
  contractId: string;
}

export interface EventWatcherConfig {
  /** Channel Auth contract ID to watch */
  contractId: string;
  /** RPC polling interval in milliseconds */
  intervalMs: number;
}
