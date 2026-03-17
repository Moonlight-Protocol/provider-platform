import { assertEquals } from "jsr:@std/assert";
import { xdr, Address, Keypair } from "stellar-sdk";
import { fetchChannelAuthEvents } from "./event-watcher.service.ts";
import type { Server } from "stellar-sdk/rpc";

// Test addresses
const TEST_ADDR_1 = Keypair.random().publicKey();
const TEST_ADDR_2 = Keypair.random().publicKey();
const TEST_CONTRACT = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFCT4";

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
    TEST_CONTRACT,
    900,
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
    TEST_CONTRACT,
    1900,
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
    TEST_CONTRACT,
    400,
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
    TEST_CONTRACT,
    900,
  );

  assertEquals(events.length, 0);
});

Deno.test("fetchChannelAuthEvents - handles empty response", async () => {
  const mockServer = createMockServer([]);

  const { events, latestLedger } = await fetchChannelAuthEvents(
    mockServer,
    TEST_CONTRACT,
    900,
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
    TEST_CONTRACT,
    900,
  );

  assertEquals(events.length, 3);
  assertEquals(events[0].type, "provider_added");
  assertEquals(events[0].address, TEST_ADDR_1);
  assertEquals(events[1].type, "provider_added");
  assertEquals(events[1].address, TEST_ADDR_2);
  assertEquals(events[2].type, "provider_removed");
  assertEquals(events[2].address, TEST_ADDR_1);
});

Deno.test("fetchChannelAuthEvents - skips events with insufficient topics", async () => {
  const mockServer = {
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
    TEST_CONTRACT,
    900,
  );

  assertEquals(events.length, 0);
});
