import { assertEquals } from "@std/assert";
import { isOutOfRetentionError } from "./retention.ts";

// --- Detection ---

Deno.test("isOutOfRetentionError - detects retention-boundary messages", () => {
  const retention = [
    "startLedger 100 is before the oldest ledger",
    "start ledger must be within the retention window",
    "ledger 5 is not within the range",
    "requested ledger out of range",
    "startLedger 12345 too old",
  ];
  for (const msg of retention) {
    assertEquals(isOutOfRetentionError(new Error(msg)), true, msg);
  }
});

Deno.test("isOutOfRetentionError - detects plain-object RPC errors (not Error instances)", () => {
  // The Stellar RPC rejects with a plain object, not an Error. String(obj)
  // would render "[object Object]" and miss the retention condition, leaving
  // the watcher stuck erroring every poll instead of recovering.
  const rpcError = {
    code: -32600,
    message: "startLedger must be within the ledger range: 3712804 - 3833763",
  };
  assertEquals(isOutOfRetentionError(rpcError), true);
});

Deno.test("isOutOfRetentionError - ignores unrelated errors", () => {
  const unrelated = [
    "connection refused",
    "timeout",
    "invalid contract id",
    "rate limited",
  ];
  for (const msg of unrelated) {
    assertEquals(isOutOfRetentionError(new Error(msg)), false, msg);
  }
});
