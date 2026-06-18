import { assertEquals } from "@std/assert";
import type { Server } from "stellar-sdk/rpc";
import { EventWatcher } from "./event-watcher.process.ts";
import { newNoop } from "@/utils/logger/index.ts";

const CONTRACT = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFCT4";

/**
 * Records the `startLedger` of each getEvents call so a test can assert exactly
 * where a fresh watcher began polling. `latestLedger` controls how far the
 * in-memory cursor advances after a poll.
 */
function mockRpc(opts: { oldestLedger: number; latestLedger: number }) {
  const startLedgers: number[] = [];
  const rpc = {
    // deno-lint-ignore require-await -- mock satisfies async getHealth contract
    getHealth: async () => ({ oldestLedger: opts.oldestLedger }),
    // deno-lint-ignore require-await -- mock satisfies async getEvents contract
    getEvents: async (req: { startLedger: number }) => {
      startLedgers.push(req.startLedger);
      return { events: [], latestLedger: opts.latestLedger };
    },
    // deno-lint-ignore require-await -- mock satisfies async getLatestLedger contract
    getLatestLedger: async () => ({ sequence: opts.latestLedger }),
  } as unknown as Server;
  return { rpc, startLedgers };
}

Deno.test("EventWatcher - override set → first getEvents at exactly that ledger", async () => {
  const { rpc, startLedgers } = mockRpc({
    oldestLedger: 5000,
    latestLedger: 5100,
  });
  const watcher = new EventWatcher(
    { contractId: CONTRACT, intervalMs: 60_000 },
    { log: newNoop(), rpc, startLedgerBlock: 12345 },
  );

  await watcher.start();
  watcher.stop();

  assertEquals(startLedgers[0], 12345);
});

Deno.test("EventWatcher - override unset → first getEvents at oldest available", async () => {
  const { rpc, startLedgers } = mockRpc({
    oldestLedger: 5000,
    latestLedger: 5100,
  });
  const watcher = new EventWatcher(
    { contractId: CONTRACT, intervalMs: 60_000 },
    { log: newNoop(), rpc, startLedgerBlock: null },
  );

  await watcher.start();
  watcher.stop();

  assertEquals(startLedgers[0], 5000);
});

// Let the fire-and-forget first poll (scheduled by start()) run to completion.
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

Deno.test("EventWatcher - holds no durable cursor: a restart re-syncs from oldest", async () => {
  // First watcher polls once and advances its in-memory cursor past 5100.
  const first = mockRpc({ oldestLedger: 5000, latestLedger: 5100 });
  const w1 = new EventWatcher(
    { contractId: CONTRACT, intervalMs: 60_000 },
    { log: newNoop(), rpc: first.rpc, startLedgerBlock: null },
  );
  await w1.start();
  await tick(); // wait for the first poll to advance the in-memory cursor
  w1.stop();
  assertEquals(w1.getLastLedger(), 5101); // advanced in memory

  // A fresh watcher (simulating a process restart) must start from oldest
  // again — nothing was persisted, so it does not resume at 5101.
  const second = mockRpc({ oldestLedger: 5000, latestLedger: 5100 });
  const w2 = new EventWatcher(
    { contractId: CONTRACT, intervalMs: 60_000 },
    { log: newNoop(), rpc: second.rpc, startLedgerBlock: null },
  );
  await w2.start();
  w2.stop();

  assertEquals(second.startLedgers[0], 5000);
});
