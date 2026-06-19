/**
 * Parse the raw `BOOT_SYNC_START_LEDGER_BLOCK` env value into the form the
 * watcher's `resolveBootStartLedger` consumes:
 *   - `"all"` (case-insensitive, trimmed) → `null` (SYNC ALL AVAILABLE)
 *   - empty / whitespace-only             → `null` (SYNC ALL AVAILABLE)
 *   - unset (`undefined`)                 → `null` (SYNC ALL AVAILABLE)
 *   - a non-negative integer string       → that ledger number (pin)
 *   - anything else (negative, `"latest"`,→ throws with the valid forms
 *     other non-numeric, ...)
 *
 * `"all"`, empty, and unset all collapse to `null`, which routes to the
 * `oldestLedger` path in `resolveBootStartLedger`; it never falls back to
 * "latest". `"all"` is the explicit, settable synonym for the empty/absent
 * default so iac can carry a real placeholder and flip it to a ledger number
 * at reset time.
 */
export function parseBootSyncStartLedger(
  raw: string | undefined,
): number | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed.toLowerCase() === "all") return null;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(
      `BOOT_SYNC_START_LEDGER_BLOCK must be "all" (sync all available), a ` +
        `non-negative integer (pin that ledger), or empty/unset, ` +
        `got: "${raw}"`,
    );
  }
  return n;
}
