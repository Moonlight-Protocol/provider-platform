/**
 * Extract searchable text from a thrown value. The Stellar RPC rejects with a
 * plain `{ code, message }` object, not an Error, so `String(error)` yields
 * "[object Object]" and loses the message. Read `.message` when present, else
 * JSON-encode, so retention detection sees the real text.
 */
function retentionErrorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error !== null && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

/**
 * Detect the Stellar RPC "startLedger out of retention" condition. When the
 * cursor predates the RPC's retention window, getEvents fails; the watcher
 * resets its cursor to re-resolve to the oldest retained ledger and reads
 * forward from there.
 */
export function isOutOfRetentionError(error: unknown): boolean {
  const msg = retentionErrorText(error).toLowerCase();
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
