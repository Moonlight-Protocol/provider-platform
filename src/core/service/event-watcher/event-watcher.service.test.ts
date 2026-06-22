import { assertEquals } from "@std/assert";
import { Address, Keypair, xdr } from "stellar-sdk";
import { fetchChannelAuthEvents } from "./event-watcher.service.ts";
import type { Server } from "stellar-sdk/rpc";
import { newNoop } from "@/utils/logger/index.ts";

// Test addresses
const TEST_ADDR_1 = Keypair.random().publicKey();
const TEST_ADDR_2 = Keypair.random().publicKey();
const TEST_CONTRACT =
  "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFCT4";

// --- Helpers ---

function buildMockEvent(
  topicSymbol: string,
  address: string,
  ledger: number,
) {
  return {
    type: "contract" as const,
    ledger,
    topic: [
      xdr.ScVal.scvSymbol(topicSymbol),
      new Address(address).toScVal(),
    ],
    value: xdr.ScVal.scvVoid(),
    id: `${ledger}-0`,
    pagingToken: `${ledger}-0`,
    inSuccessfulContractCall: true,
    contractId: TEST_CONTRACT,
  };
}

function createMockServer(events: ReturnType<typeof buildMockEvent>[]): Server {
  return {
    // deno-lint-ignore require-await -- mock satisfies getEvents async contract
    getEvents: async () => ({
      events,
      latestLedger: events.length > 0
        ? Math.max(...events.map((e) => e.ledger))
        : 100,
    }),
  } as unknown as Server;
}

// --- Tests ---

Deno.test("fetchChannelAuthEvents - parses provider_added event", async () => {
  const mockServer = createMockServer([
    buildMockEvent("provider_added", TEST_ADDR_1, 1000),
  ]);

  const { events, latestLedger } = await fetchChannelAuthEvents(
    mockServer,
    [TEST_CONTRACT],
    900,
    { log: newNoop() },
  );

  assertEquals(events.length, 1);
  assertEquals(events[0].type, "provider_added");
  assertEquals(events[0].address, TEST_ADDR_1);
  assertEquals(events[0].ledger, 1000);
  assertEquals(latestLedger, 1000);
});

Deno.test("fetchChannelAuthEvents - parses provider_removed event", async () => {
  const mockServer = createMockServer([
    buildMockEvent("provider_removed", TEST_ADDR_1, 2000),
  ]);

  const { events } = await fetchChannelAuthEvents(
    mockServer,
    [TEST_CONTRACT],
    1900,
    { log: newNoop() },
  );

  assertEquals(events.length, 1);
  assertEquals(events[0].type, "provider_removed");
  assertEquals(events[0].address, TEST_ADDR_1);
});

Deno.test("fetchChannelAuthEvents - parses contract_initialized event", async () => {
  const mockServer = createMockServer([
    buildMockEvent("contract_initialized", TEST_ADDR_1, 500),
  ]);

  const { events } = await fetchChannelAuthEvents(
    mockServer,
    [TEST_CONTRACT],
    400,
    { log: newNoop() },
  );

  assertEquals(events.length, 1);
  assertEquals(events[0].type, "contract_initialized");
  assertEquals(events[0].address, TEST_ADDR_1);
});

Deno.test("fetchChannelAuthEvents - ignores unknown event topics", async () => {
  const mockServer = createMockServer([
    buildMockEvent("some_unknown_event", TEST_ADDR_1, 1000),
  ]);

  const { events } = await fetchChannelAuthEvents(
    mockServer,
    [TEST_CONTRACT],
    900,
    { log: newNoop() },
  );

  assertEquals(events.length, 0);
});

Deno.test("fetchChannelAuthEvents - handles empty response", async () => {
  const mockServer = createMockServer([]);

  const { events, latestLedger } = await fetchChannelAuthEvents(
    mockServer,
    [TEST_CONTRACT],
    900,
    { log: newNoop() },
  );

  assertEquals(events.length, 0);
  assertEquals(latestLedger, 100);
});

Deno.test("fetchChannelAuthEvents - parses multiple events in order", async () => {
  const mockServer = createMockServer([
    buildMockEvent("provider_added", TEST_ADDR_1, 1000),
    buildMockEvent("provider_added", TEST_ADDR_2, 1001),
    buildMockEvent("provider_removed", TEST_ADDR_1, 1002),
  ]);

  const { events } = await fetchChannelAuthEvents(
    mockServer,
    [TEST_CONTRACT],
    900,
    { log: newNoop() },
  );

  assertEquals(events.length, 3);
  assertEquals(events[0].type, "provider_added");
  assertEquals(events[0].address, TEST_ADDR_1);
  assertEquals(events[1].type, "provider_added");
  assertEquals(events[1].address, TEST_ADDR_2);
  assertEquals(events[2].type, "provider_removed");
  assertEquals(events[2].address, TEST_ADDR_1);
});

function buildChannelStateEvent(
  channel: string,
  asset: string,
  enabled: boolean,
  ledger: number,
) {
  return {
    type: "contract" as const,
    ledger,
    topic: [
      xdr.ScVal.scvSymbol("channel_state_changed"),
      new Address(channel).toScVal(),
      new Address(asset).toScVal(),
    ],
    value: xdr.ScVal.scvBool(enabled),
    id: `${ledger}-0`,
    pagingToken: `${ledger}-0`,
    inSuccessfulContractCall: true,
    contractId: TEST_CONTRACT,
  };
}

Deno.test("fetchChannelAuthEvents - parses channel_state_changed (disabled)", async () => {
  const mockServer = createMockServer([
    buildChannelStateEvent(TEST_ADDR_1, TEST_ADDR_2, false, 3000),
  ]);

  const { events } = await fetchChannelAuthEvents(
    mockServer,
    [TEST_CONTRACT],
    2900,
    { log: newNoop() },
  );

  assertEquals(events.length, 1);
  assertEquals(events[0].type, "channel_state_changed");
  assertEquals(events[0].channel, TEST_ADDR_1);
  assertEquals(events[0].asset, TEST_ADDR_2);
  assertEquals(events[0].enabled, false);
});

Deno.test("fetchChannelAuthEvents - parses channel_state_changed (enabled)", async () => {
  const mockServer = createMockServer([
    buildChannelStateEvent(TEST_ADDR_1, TEST_ADDR_2, true, 3100),
  ]);

  const { events } = await fetchChannelAuthEvents(
    mockServer,
    [TEST_CONTRACT],
    3000,
    { log: newNoop() },
  );

  assertEquals(events.length, 1);
  assertEquals(events[0].type, "channel_state_changed");
  assertEquals(events[0].enabled, true);
});

// --- Multi-contract batching / routing ---

const TEST_CONTRACT_2 =
  "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBV6";

/** A provider_added event tagged as emitted by a specific source contract. */
function buildMockEventFor(
  contractId: string,
  topicSymbol: string,
  address: string,
  ledger: number,
) {
  return { ...buildMockEvent(topicSymbol, address, ledger), contractId };
}

/**
 * Records the `filters` of every getEvents call so a test can assert how the
 * watched contract set was batched, and serves the given events back.
 */
function createCapturingServer(
  events: ReturnType<typeof buildMockEvent>[],
  latestLedger = 100,
) {
  const calls: { contractIds: string[][] }[] = [];
  const server = {
    // deno-lint-ignore require-await -- mock satisfies getEvents async contract
    getEvents: async (
      req: { filters: { contractIds?: string[] }[] },
    ) => {
      calls.push({
        contractIds: req.filters.map((f) => f.contractIds ?? []),
      });
      // Only return events whose source contract is covered by this call's
      // filters, mirroring how the RPC scopes results.
      const covered = new Set(req.filters.flatMap((f) => f.contractIds ?? []));
      return {
        events: events.filter((e) => covered.has(e.contractId)),
        latestLedger,
      };
    },
  } as unknown as Server;
  return { server, calls };
}

Deno.test("fetchChannelAuthEvents - tags each parsed event with its source contract", async () => {
  const { server } = createCapturingServer([
    buildMockEventFor(TEST_CONTRACT, "provider_added", TEST_ADDR_1, 1000),
    buildMockEventFor(TEST_CONTRACT_2, "provider_added", TEST_ADDR_2, 1001),
  ]);

  const { events } = await fetchChannelAuthEvents(
    server,
    [TEST_CONTRACT, TEST_CONTRACT_2],
    900,
    { log: newNoop() },
  );

  assertEquals(events.length, 2);
  assertEquals(events[0].contractId, TEST_CONTRACT);
  assertEquals(events[1].contractId, TEST_CONTRACT_2);
});

Deno.test("fetchChannelAuthEvents - one poll covers multiple contracts in a single call", async () => {
  const { server, calls } = createCapturingServer([
    buildMockEventFor(TEST_CONTRACT, "provider_added", TEST_ADDR_1, 1000),
    buildMockEventFor(TEST_CONTRACT_2, "provider_removed", TEST_ADDR_2, 1001),
  ]);

  await fetchChannelAuthEvents(
    server,
    [TEST_CONTRACT, TEST_CONTRACT_2],
    900,
    { log: newNoop() },
  );

  // ≤5 contracts → exactly one getEvents call, both contracts in one filter.
  assertEquals(calls.length, 1);
  assertEquals(calls[0].contractIds, [[TEST_CONTRACT, TEST_CONTRACT_2]]);
});

Deno.test("fetchChannelAuthEvents - empty contract set never queries the RPC", async () => {
  const { server, calls } = createCapturingServer([]);

  const { events } = await fetchChannelAuthEvents(
    server,
    [],
    900,
    { log: newNoop() },
  );

  assertEquals(events.length, 0);
  assertEquals(calls.length, 0); // never call getEvents with empty filters
});

Deno.test("fetchChannelAuthEvents - batches >25 contracts across calls within 5x5 limits", async () => {
  // 27 synthetic contract ids → 2 calls (25 + 2), filters of ≤5 ids each.
  const contractIds = Array.from(
    { length: 27 },
    (_, i) => `CONTRACT_${i}`,
  );
  const { server, calls } = createCapturingServer([]);

  await fetchChannelAuthEvents(server, contractIds, 900, { log: newNoop() });

  assertEquals(calls.length, 2); // 25 per call → ceil(27/25) = 2
  for (const call of calls) {
    assertEquals(call.contractIds.length <= 5, true); // ≤5 filters per call
    for (const ids of call.contractIds) {
      assertEquals(ids.length <= 5, true); // ≤5 contractIds per filter
    }
  }
  // No contract is dropped: every id appears exactly once across all calls.
  const seen = calls.flatMap((c) => c.contractIds.flat());
  assertEquals(seen.length, 27);
  assertEquals(new Set(seen).size, 27);
});

Deno.test("fetchChannelAuthEvents - skips events with insufficient topics", async () => {
  const mockServer = {
    // deno-lint-ignore require-await -- mock satisfies getEvents async contract
    getEvents: async () => ({
      events: [
        {
          type: "contract" as const,
          ledger: 1000,
          topic: [xdr.ScVal.scvSymbol("provider_added")], // only 1 topic, need 2
          value: xdr.ScVal.scvVoid(),
          id: "1000-0",
          pagingToken: "1000-0",
          inSuccessfulContractCall: true,
          contractId: TEST_CONTRACT,
        },
      ],
      latestLedger: 1000,
    }),
  } as unknown as Server;

  const { events } = await fetchChannelAuthEvents(
    mockServer,
    [TEST_CONTRACT],
    900,
    { log: newNoop() },
  );

  assertEquals(events.length, 0);
});
