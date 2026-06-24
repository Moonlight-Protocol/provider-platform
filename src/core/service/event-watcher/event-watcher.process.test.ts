import { assertEquals } from "@std/assert";
import { Address, Keypair, xdr } from "stellar-sdk";
import type { Server } from "stellar-sdk/rpc";
import { EventWatcher } from "./event-watcher.process.ts";
import type { ChannelAuthEvent } from "./event-watcher.types.ts";
import { newNoop } from "@/utils/logger/index.ts";

const CONTRACT = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFCT4";
const CONTRACT_B = "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBV6";

// The boot start ledger now resolves inside the first poll (so a transient
// failure retries instead of killing the watcher in start()), so every
// assertion about where the watcher began polling must let that fire-and-forget
// first poll run to completion.
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

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
  await tick(); // let the first poll resolve the boot ledger and fetch
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
  await tick(); // let the first poll resolve the boot ledger and fetch
  watcher.stop();

  assertEquals(startLedgers[0], 5000);
});

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
  await tick(); // let the fresh watcher's first poll resolve + fetch
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

// --- Boot resilience ---

/** A raw provider_added RPC event the real parser accepts, for CONTRACT. */
function rawProviderAddedEvent(address: string, ledger: number) {
  return {
    type: "contract" as const,
    ledger,
    topic: [
      xdr.ScVal.scvSymbol("provider_added"),
      new Address(address).toScVal(),
    ],
    value: xdr.ScVal.scvVoid(),
    id: `${ledger}-0`,
    pagingToken: `${ledger}-0`,
    inSuccessfulContractCall: true,
    contractId: CONTRACT,
  };
}

/**
 * RPC mock whose boot-ledger resolution (getHealth) THROWS on its first call
 * and recovers afterwards. Once recovered, getEvents serves a single
 * provider_added event so a test can prove the watcher actually resumes polling
 * and processing — not merely that it survived.
 */
function flakyBootRpc(
  opts: { oldestLedger: number; latestLedger: number; address: string },
) {
  let healthCalls = 0;
  let eventsServed = false;
  const rpc = {
    // deno-lint-ignore require-await -- mock satisfies async getHealth contract
    getHealth: async () => {
      healthCalls++;
      if (healthCalls === 1) {
        throw new Error("transient RPC failure resolving boot ledger");
      }
      return { oldestLedger: opts.oldestLedger };
    },
    // deno-lint-ignore require-await -- mock satisfies async getEvents contract
    getEvents: async () => {
      // Serve the event exactly once so the watcher processes it after recovery.
      const events = eventsServed
        ? []
        : [rawProviderAddedEvent(opts.address, opts.latestLedger)];
      eventsServed = true;
      return { events, latestLedger: opts.latestLedger };
    },
    // deno-lint-ignore require-await -- mock satisfies async getLatestLedger contract
    getLatestLedger: async () => ({ sequence: opts.latestLedger }),
  } as unknown as Server;
  return { rpc, healthCalls: () => healthCalls };
}

/** Poll `predicate` on the macrotask queue until true or `timeoutMs` elapses. */
async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  return predicate();
}

Deno.test("EventWatcher - transient boot-ledger failure retries instead of killing the watcher", async () => {
  const ADDRESS = Keypair.random().publicKey();
  const { rpc, healthCalls } = flakyBootRpc({
    oldestLedger: 5000,
    latestLedger: 5100,
    address: ADDRESS,
  });

  const received: ChannelAuthEvent[] = [];
  const watcher = new EventWatcher(
    { contractIds: [CONTRACT], intervalMs: 20 },
    { log: newNoop(), rpc, startLedgerBlock: null },
  );
  watcher.onEvent((event) => {
    received.push(event);
  });

  // The first poll's getHealth throws. Pre-fix this rejected start() and the
  // poll loop never ran; the watcher stayed dead forever. It must instead retry.
  await watcher.start();

  const recovered = await waitUntil(() => received.length > 0);
  watcher.stop();

  // The first boot resolution failed (proving the failure path was exercised)…
  // …yet the watcher recovered: it resolved the boot ledger on a later tick,
  // polled, and processed the on-chain event.
  assertEquals(recovered, true);
  assertEquals(healthCalls() >= 2, true);
  assertEquals(received.length, 1);
  assertEquals(received[0].type, "provider_added");
  assertEquals(received[0].address, ADDRESS);
  // Cursor advanced past the latest ledger — the loop is live, not stuck at boot.
  assertEquals(watcher.getLastLedger(), 5101);
});
