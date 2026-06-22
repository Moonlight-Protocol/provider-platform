import { assertEquals } from "@std/assert";
import type { Server } from "stellar-sdk/rpc";
import { EventWatcher } from "./event-watcher.process.ts";
import { newNoop } from "@/utils/logger/index.ts";

const CONTRACT = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFCT4";
const CONTRACT_B = "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBV6";

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

/**
 * Like `mockRpc` but also records the contractIds in each poll's filter, so a
 * test can assert exactly which contracts a single watcher covered per poll.
 */
function capturingRpc(opts: { oldestLedger: number; latestLedger: number }) {
  const polledContractIds: string[][] = [];
  const rpc = {
    // deno-lint-ignore require-await -- mock satisfies async getHealth contract
    getHealth: async () => ({ oldestLedger: opts.oldestLedger }),
    // deno-lint-ignore require-await -- mock satisfies async getEvents contract
    getEvents: async (
      req: { startLedger: number; filters: { contractIds?: string[] }[] },
    ) => {
      polledContractIds.push(req.filters.flatMap((f) => f.contractIds ?? []));
      return { events: [], latestLedger: opts.latestLedger };
    },
    // deno-lint-ignore require-await -- mock satisfies async getLatestLedger contract
    getLatestLedger: async () => ({ sequence: opts.latestLedger }),
  } as unknown as Server;
  return { rpc, polledContractIds };
}

Deno.test("EventWatcher - override set → first getEvents at exactly that ledger", async () => {
  const { rpc, startLedgers } = mockRpc({
    oldestLedger: 5000,
    latestLedger: 5100,
  });
  const watcher = new EventWatcher(
    { contractIds: [CONTRACT], intervalMs: 60_000 },
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
    { contractIds: [CONTRACT], intervalMs: 60_000 },
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
    { contractIds: [CONTRACT], intervalMs: 60_000 },
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
    { contractIds: [CONTRACT], intervalMs: 60_000 },
    { log: newNoop(), rpc: second.rpc, startLedgerBlock: null },
  );
  await w2.start();
  w2.stop();

  assertEquals(second.startLedgers[0], 5000);
});

Deno.test("EventWatcher - getContractIds reflects in-place add/remove", () => {
  const { rpc } = mockRpc({ oldestLedger: 5000, latestLedger: 5100 });
  const watcher = new EventWatcher(
    { contractIds: [CONTRACT], intervalMs: 60_000 },
    { log: newNoop(), rpc, startLedgerBlock: 1 },
  );

  assertEquals(watcher.getContractIds(), [CONTRACT]);

  watcher.addContract(CONTRACT_B);
  assertEquals(watcher.getContractIds().sort(), [CONTRACT, CONTRACT_B].sort());

  watcher.addContract(CONTRACT_B); // idempotent
  assertEquals(watcher.getContractIds().length, 2);

  watcher.removeContract(CONTRACT);
  assertEquals(watcher.getContractIds(), [CONTRACT_B]);
});

Deno.test("EventWatcher - one watcher polls every contract added before start", async () => {
  const { rpc, polledContractIds } = capturingRpc({
    oldestLedger: 5000,
    latestLedger: 5100,
  });
  const watcher = new EventWatcher(
    { contractIds: [CONTRACT], intervalMs: 60_000 },
    { log: newNoop(), rpc, startLedgerBlock: 1 },
  );
  watcher.addContract(CONTRACT_B); // a second council joins before boot completes

  await watcher.start();
  await tick(); // let the first poll run
  watcher.stop();

  // A single poll covered BOTH councils' contracts (not one poll per council).
  assertEquals(polledContractIds.length, 1);
  assertEquals(polledContractIds[0].sort(), [CONTRACT, CONTRACT_B].sort());
});

Deno.test("EventWatcher - removed contract is no longer polled", async () => {
  const { rpc, polledContractIds } = capturingRpc({
    oldestLedger: 5000,
    latestLedger: 5100,
  });
  const watcher = new EventWatcher(
    { contractIds: [CONTRACT, CONTRACT_B], intervalMs: 60_000 },
    { log: newNoop(), rpc, startLedgerBlock: 1 },
  );
  watcher.removeContract(CONTRACT); // membership in CONTRACT went inactive

  await watcher.start();
  await tick();
  watcher.stop();

  assertEquals(polledContractIds[0], [CONTRACT_B]); // CONTRACT dropped from poll
});

Deno.test("EventWatcher - empty contract set holds the cursor and skips the RPC", async () => {
  const { rpc, polledContractIds } = capturingRpc({
    oldestLedger: 5000,
    latestLedger: 5100,
  });
  const watcher = new EventWatcher(
    { contractIds: [], intervalMs: 60_000 },
    { log: newNoop(), rpc, startLedgerBlock: 7000 },
  );

  await watcher.start();
  await tick();
  watcher.stop();

  // No contracts → never query getEvents, and the cursor stays at the boot
  // ledger so a later join resumes from there.
  assertEquals(polledContractIds.length, 0);
  assertEquals(watcher.getLastLedger(), 7000);
});
