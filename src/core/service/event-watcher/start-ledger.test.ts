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

Deno.test("resolveBootStartLedger - pin within the retention window → starts at the pin", async () => {
  const rpc = rpcWithOldest(5000);

  const start = await resolveBootStartLedger(rpc, 12345);

  assertEquals(start, 12345);
  // getHealth is consulted so the pin can be checked against the retention floor.
  assertEquals(rpc.healthCalls, 1);
});

Deno.test("resolveBootStartLedger - pin older than oldest retained → clamps up to oldest", async () => {
  const rpc = rpcWithOldest(3723170);

  // The real failure: a stale reset pin (~a month back) that fell out of the
  // retention window. Clamp to oldest instead of passing an out-of-range value.
  const start = await resolveBootStartLedger(rpc, 3177789);

  assertEquals(start, 3723170);
  assertEquals(rpc.healthCalls, 1);
});

Deno.test("resolveBootStartLedger - override unset → starts at oldest available", async () => {
  const rpc = rpcWithOldest(5000);

  const start = await resolveBootStartLedger(rpc, null);

  assertEquals(start, 5000);
  assertEquals(rpc.healthCalls, 1);
});

Deno.test("resolveBootStartLedger - pin of 0 clamps to oldest (everything still retained)", async () => {
  const rpc = rpcWithOldest(5000);

  const start = await resolveBootStartLedger(rpc, 0);

  assertEquals(start, 5000);
  assertEquals(rpc.healthCalls, 1);
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

Deno.test("parse + resolve - in-window integer → pins that exact ledger", async () => {
  const rpc = rpcWithOldest(5000);
  assertEquals(
    await resolveBootStartLedger(rpc, parseBootSyncStartLedger("12345")),
    12345,
  );
  assertEquals(rpc.healthCalls, 1);
});
