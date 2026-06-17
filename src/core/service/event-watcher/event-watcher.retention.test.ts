import { assertEquals } from "@std/assert";
import { newNoop } from "@/utils/logger/index.ts";
import {
  isOutOfRetentionError,
  recoverFromOutOfRetention,
} from "./retention.ts";

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

// --- Recovery: reset cursor + fire resync (re-query council) ---

Deno.test("recoverFromOutOfRetention - resets cursor to latest and re-queries", async () => {
  let resyncFired = false;
  const newCursor = await recoverFromOutOfRetention(
    new Error("startLedger 1 is before the oldest ledger 5000"),
    () => Promise.resolve({ sequence: 5000 }),
    () => {
      resyncFired = true;
    },
    newNoop(),
  );

  // Cursor jumps past the current latest ledger so the next poll succeeds...
  assertEquals(newCursor, 5001);
  // ...and the council re-query (resync) fired to reconcile missed state.
  assertEquals(resyncFired, true);
});

Deno.test("recoverFromOutOfRetention - no-op for unrelated errors", async () => {
  let resyncFired = false;
  const result = await recoverFromOutOfRetention(
    new Error("connection refused"),
    () => Promise.resolve({ sequence: 9000 }),
    () => {
      resyncFired = true;
    },
    newNoop(),
  );

  assertEquals(result, null);
  assertEquals(resyncFired, false);
});
