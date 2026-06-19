import { assertEquals } from "@std/assert";
import { parseBootSyncStartLedger } from "@/utils/env/parseBootSyncStartLedger.ts";
import { type BootSyncRpc, resolveBootStartLedger } from "./start-ledger.ts";

function rpcWithOldest(oldestLedger: number): BootSyncRpc & {
  healthCalls: number;
} {
  return {
    healthCalls: 0,
    // deno-lint-ignore require-await -- mock satisfies async getHealth contract
    async getHealth() {
      this.healthCalls++;
      return { oldestLedger };
    },
  };
}

Deno.test("resolveBootStartLedger - override set → starts at exactly that ledger", async () => {
  const rpc = rpcWithOldest(5000);

  const start = await resolveBootStartLedger(rpc, 12345);

  assertEquals(start, 12345);
  // The override wins without consulting the RPC at all.
  assertEquals(rpc.healthCalls, 0);
});

Deno.test("resolveBootStartLedger - override unset → starts at oldest available", async () => {
  const rpc = rpcWithOldest(5000);

  const start = await resolveBootStartLedger(rpc, null);

  assertEquals(start, 5000);
  assertEquals(rpc.healthCalls, 1);
});

Deno.test("resolveBootStartLedger - override of 0 is honored (not treated as unset)", async () => {
  const rpc = rpcWithOldest(5000);

  const start = await resolveBootStartLedger(rpc, 0);

  assertEquals(start, 0);
  assertEquals(rpc.healthCalls, 0);
});

// Integration: the parsed env value (from utils) flows through to the resolved
// start ledger. "all" / empty / unset all take the oldestLedger path.
Deno.test("parse + resolve - 'all' / empty / unset → starts at oldest", async () => {
  for (const raw of ["all", "ALL", " all ", "", "   ", undefined]) {
    const rpc = rpcWithOldest(5000);
    assertEquals(
      await resolveBootStartLedger(rpc, parseBootSyncStartLedger(raw)),
      5000,
    );
    assertEquals(rpc.healthCalls, 1);
  }
});

Deno.test("parse + resolve - non-negative integer → pins that exact ledger", async () => {
  const rpc = rpcWithOldest(5000);
  assertEquals(
    await resolveBootStartLedger(rpc, parseBootSyncStartLedger("12345")),
    12345,
  );
  // Pinned: resolution never consults the RPC.
  assertEquals(rpc.healthCalls, 0);
});
