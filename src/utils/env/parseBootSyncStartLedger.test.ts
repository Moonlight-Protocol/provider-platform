import { assertEquals, assertThrows } from "@std/assert";
import { parseBootSyncStartLedger } from "./parseBootSyncStartLedger.ts";

Deno.test("parseBootSyncStartLedger - 'all' (and ALL / ' all ') → null", () => {
  for (const raw of ["all", "ALL", " all "]) {
    assertEquals(parseBootSyncStartLedger(raw), null);
  }
});

Deno.test("parseBootSyncStartLedger - empty / whitespace-only → null", () => {
  for (const raw of ["", "   "]) {
    assertEquals(parseBootSyncStartLedger(raw), null);
  }
});

Deno.test("parseBootSyncStartLedger - unset (undefined) → null", () => {
  assertEquals(parseBootSyncStartLedger(undefined), null);
});

Deno.test("parseBootSyncStartLedger - non-negative integer → that number", () => {
  assertEquals(parseBootSyncStartLedger("12345"), 12345);
  assertEquals(parseBootSyncStartLedger("0"), 0);
});

Deno.test("parseBootSyncStartLedger - 'latest' / negative / junk → throws valid-forms message", () => {
  for (const bad of ["latest", "-1", "abc", "1.5"]) {
    assertThrows(
      () => parseBootSyncStartLedger(bad),
      Error,
      'BOOT_SYNC_START_LEDGER_BLOCK must be "all"',
    );
  }
});
