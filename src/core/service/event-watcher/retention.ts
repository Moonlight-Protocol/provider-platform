import type { Logger } from "@/utils/logger/index.ts";

/**
 * Detect the Stellar RPC "startLedger out of retention" condition. When the
 * persisted cursor predates the RPC's retention window, getEvents fails and we
 * must reset the cursor and reconcile state via a council query instead.
 */
export function isOutOfRetentionError(error: unknown): boolean {
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
 * Recover from an out-of-retention cursor: if `error` is the retention
 * condition, jump the cursor to the current latest ledger (events between the
 * stale cursor and now are unrecoverable from RPC) and fire the resync so state
 * is reconciled via a council query. Returns the new cursor, or null when the
 * error is unrelated (caller handles it as an ordinary poll error).
 */
export async function recoverFromOutOfRetention(
  error: unknown,
  getLatestLedger: () => Promise<{ sequence: number }>,
  onResync: () => Promise<void> | void,
  log: Logger,
): Promise<number | null> {
  if (!isOutOfRetentionError(error)) return null;
  log.event("EventWatcher cursor out of retention; recovering");
  const latest = await getLatestLedger();
  await onResync();
  return latest.sequence + 1;
}
