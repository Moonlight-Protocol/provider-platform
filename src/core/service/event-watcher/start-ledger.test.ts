import { assertEquals } from "@std/assert";
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
