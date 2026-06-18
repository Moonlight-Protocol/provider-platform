/**
 * Minimal RPC surface needed to resolve a boot start ledger. The Stellar RPC
 * `getHealth` response carries `oldestLedger` — the oldest ledger still inside
 * the server's retention window.
 */
export interface BootSyncRpc {
  getHealth(): Promise<{ oldestLedger: number }>;
}

/**
 * Resolve the ledger a fresh watcher (no stored position) should begin polling.
 *
 * Default is SYNC ALL AVAILABLE: start from the oldest ledger the RPC still
 * retains, so no on-chain event inside the retention window is skipped on a cold
 * boot. An explicit `BOOT_SYNC_START_LEDGER_BLOCK` override starts at that exact
 * ledger instead. This never falls back to "latest" — that would silently skip
 * the gap between the last poll and now.
 */
export async function resolveBootStartLedger(
  rpc: BootSyncRpc,
  startLedgerBlock: number | null,
): Promise<number> {
  if (startLedgerBlock !== null) return startLedgerBlock;
  const { oldestLedger } = await rpc.getHealth();
  return oldestLedger;
}
