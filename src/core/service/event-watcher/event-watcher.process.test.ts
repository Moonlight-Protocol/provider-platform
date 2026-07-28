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

Deno.test("EventWatcher - live reads from the tip; backfill reads from the override", async () => {
  const { rpc, startLedgers } = mockRpc({
    oldestLedger: 5000,
    latestLedger: 5100,
  });
  const watcher = new EventWatcher(
    { contractIds: [CONTRACT], intervalMs: 60_000 },
    { log: newNoop(), rpc, startLedgerBlock: 5050 },
  );

  await watcher.start();
  await tick(); // let the first poll init cursors + do live and backfill reads
  watcher.stop();

  // Live follows the tip so new events are caught within one interval; backfill
  // walks history forward from the override.
  assertEquals(startLedgers[0], 5100); // live: the tip
  assertEquals(startLedgers.includes(5050), true); // backfill: the override
});

Deno.test("EventWatcher - live reads from the tip; backfill reads from oldest when unset", async () => {
  const { rpc, startLedgers } = mockRpc({
    oldestLedger: 5000,
    latestLedger: 5100,
  });
  const watcher = new EventWatcher(
    { contractIds: [CONTRACT], intervalMs: 60_000 },
    { log: newNoop(), rpc, startLedgerBlock: null },
  );

  await watcher.start();
  await tick();
  watcher.stop();

  assertEquals(startLedgers[0], 5100); // live: the tip
  assertEquals(startLedgers.includes(5000), true); // backfill: oldest available
});

Deno.test("EventWatcher - holds no durable cursor: a restart re-walks history from oldest", async () => {
  const first = mockRpc({ oldestLedger: 5000, latestLedger: 5100 });
  const w1 = new EventWatcher(
    { contractIds: [CONTRACT], intervalMs: 60_000 },
    { log: newNoop(), rpc: first.rpc, startLedgerBlock: null },
  );
  await w1.start();
  await tick();
  w1.stop();
  assertEquals(w1.getLastLedger(), 5101); // live advanced past the tip

  // A fresh watcher (simulating a process restart) re-walks history from oldest
  // — nothing was persisted.
  const second = mockRpc({ oldestLedger: 5000, latestLedger: 5100 });
  const w2 = new EventWatcher(
    { contractIds: [CONTRACT], intervalMs: 60_000 },
    { log: newNoop(), rpc: second.rpc, startLedgerBlock: null },
  );
  await w2.start();
  await tick();
  w2.stop();

  assertEquals(second.startLedgers.includes(5000), true); // backfill from oldest
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

Deno.test("EventWatcher - one watcher covers every contract added before start", async () => {
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
  await tick(); // let the first poll run (live + backfill reads)
  watcher.stop();

  // Every getEvents call (live and backfill alike) batches BOTH councils'
  // contracts — one watcher, not one per council.
  assertEquals(polledContractIds.length >= 1, true);
  for (const polled of polledContractIds) {
    assertEquals(polled.sort(), [CONTRACT, CONTRACT_B].sort());
  }
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

  // Neither the live nor the backfill read includes the dropped contract.
  assertEquals(polledContractIds.length >= 1, true);
  for (const polled of polledContractIds) {
    assertEquals(polled, [CONTRACT_B]);
  }
});

Deno.test("EventWatcher - empty contract set skips the RPC and holds the live cursor at the tip", async () => {
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

  // No contracts → never query getEvents. The live cursor holds at the tip so a
  // later join resumes from there.
  assertEquals(polledContractIds.length, 0);
  assertEquals(watcher.getLastLedger(), 5100);
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

/**
 * RPC mock with a huge gap between oldest and the tip: a live read (startLedger
 * at/after the tip) serves a provider_added event immediately, while a backfill
 * read (startLedger far below the tip) returns nothing and advances only a
 * bounded slice. Proves the live path catches a tip event on the first poll
 * even though backfill has an enormous range still to walk.
 */
function tipEventDeepBackfill(
  opts: { oldestLedger: number; tip: number; address: string },
) {
  const rpc = {
    // deno-lint-ignore require-await -- mock satisfies async getHealth contract
    getHealth: async () => ({ oldestLedger: opts.oldestLedger }),
    // deno-lint-ignore require-await -- mock satisfies async getLatestLedger contract
    getLatestLedger: async () => ({ sequence: opts.tip }),
    // deno-lint-ignore require-await -- mock satisfies async getEvents contract
    getEvents: async (req: { startLedger: number }) => {
      if (req.startLedger >= opts.tip) {
        // Live read at the tip — the new event is here.
        return {
          events: [rawProviderAddedEvent(opts.address, opts.tip)],
          latestLedger: opts.tip,
        };
      }
      // Backfill read far below the tip — a bounded, empty slice (crawls).
      return { events: [], latestLedger: req.startLedger + 10 };
    },
  } as unknown as Server;
  return { rpc };
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

Deno.test("EventWatcher - live catches a tip event on the first poll despite a deep pending backfill", async () => {
  const ADDRESS = Keypair.random().publicKey();
  // Backfilling from oldest (1_000) to the tip (900_000) is ~90k bounded slices
  // — but the live read at the tip must land the event on the very first poll,
  // not wait for backfill to crawl there.
  const { rpc } = tipEventDeepBackfill({
    oldestLedger: 1_000,
    tip: 900_000,
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

  await watcher.start();
  const got = await waitUntil(() => received.length > 0);
  watcher.stop();

  assertEquals(got, true);
  assertEquals(received[0].type, "provider_added");
  assertEquals(received[0].address, ADDRESS);
  // The live cursor sits at the tip, not down where backfill is still crawling.
  assertEquals(watcher.getLastLedger(), 900_001);
});
