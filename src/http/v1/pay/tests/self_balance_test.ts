/**
 * Integration tests for the self-custodial balance handler.
 *
 * Uses mocked channel.service.ts (via deno.json import map) to avoid
 * importing env.ts and the real Stellar SDK client.
 * Run with: deno test --allow-all --config src/http/v1/pay/tests/deno.json src/http/v1/pay/tests/self_balance_test.ts
 */
import { assertEquals } from "@std/assert";
import { postSelfBalanceHandler } from "@/http/v1/pay/self/balance.ts";
import {
  _resetMockBalances,
  _setMockBalances,
} from "./mock_channel_service.ts";
import { testAddress } from "./test_helpers.ts";

// ---------------------------------------------------------------------------
// Mock Oak Context helper
// ---------------------------------------------------------------------------

type MockResponse = { status: number; body: unknown };

function createMockContext(
  body: unknown,
  session: unknown,
): {
  ctx: Parameters<typeof postSelfBalanceHandler>[0];
  getResponse: () => MockResponse;
} {
  let responseStatus = 200;
  let responseBody: unknown = undefined;

  const ctx = {
    request: {
      body: { json: () => Promise.resolve(body) },
    },
    response: {
      get status() {
        return responseStatus;
      },
      set status(s: number) {
        responseStatus = s;
      },
      get body() {
        return responseBody;
      },
      set body(b: unknown) {
        responseBody = b;
      },
    },
    state: { session },
  };

  return {
    // deno-lint-ignore no-explicit-any
    ctx: ctx as any,
    getResponse: () => ({ status: responseStatus, body: responseBody }),
  };
}

function selfCustodialSession(stellarAddress: string) {
  return {
    iss: "https://localhost",
    sub: stellarAddress,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    sessionId: crypto.randomUUID(),
    type: "sep10" as const,
  };
}

// Hex-encode a dummy 33-byte P256 public key
function dummyHexPubKey(): string {
  const bytes = new Uint8Array(33);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// Successful balance query
// ---------------------------------------------------------------------------

Deno.test("self balance - returns balances for given public keys", async () => {
  _setMockBalances([5_000_000n, 3_000_000n]);

  const pk1 = dummyHexPubKey();
  const pk2 = dummyHexPubKey();

  const { ctx, getResponse } = createMockContext(
    { publicKeys: [pk1, pk2], channelContractId: "CTEST" },
    selfCustodialSession(testAddress()),
  );

  await postSelfBalanceHandler(ctx);
  const res = getResponse();

  assertEquals(
    res.status,
    200,
    `Expected 200 but got ${res.status}: ${JSON.stringify(res.body)}`,
  );
  assertEquals((res.body as { message: string }).message, "Balance retrieved");

  // deno-lint-ignore no-explicit-any
  const data = (res.body as { data: any }).data;
  assertEquals(data.totalBalance, "8000000");
  assertEquals(data.utxoCount, 2);
  assertEquals(data.freeSlots, 298); // MAX_UTXO_SLOTS(300) - 2
  assertEquals(data.utxos.length, 2);
  assertEquals(data.utxos[0].publicKey, pk1);
  assertEquals(data.utxos[0].balance, "5000000");
  assertEquals(data.utxos[1].publicKey, pk2);
  assertEquals(data.utxos[1].balance, "3000000");

  _resetMockBalances();
});

// ---------------------------------------------------------------------------
// Zero balances
// ---------------------------------------------------------------------------

Deno.test("self balance - returns zero balances for empty UTXOs", async () => {
  _setMockBalances([0n, 0n]);

  const pk1 = dummyHexPubKey();
  const pk2 = dummyHexPubKey();

  const { ctx, getResponse } = createMockContext(
    { publicKeys: [pk1, pk2], channelContractId: "CTEST" },
    selfCustodialSession(testAddress()),
  );

  await postSelfBalanceHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 200);
  // deno-lint-ignore no-explicit-any
  const data = (res.body as { data: any }).data;
  assertEquals(data.totalBalance, "0");
  assertEquals(data.utxoCount, 0);

  _resetMockBalances();
});

// ---------------------------------------------------------------------------
// Empty publicKeys array returns 400
// ---------------------------------------------------------------------------

Deno.test("self balance - empty publicKeys array returns 400", async () => {
  const { ctx, getResponse } = createMockContext(
    { publicKeys: [], channelContractId: "CTEST" },
    selfCustodialSession(testAddress()),
  );

  await postSelfBalanceHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 400);
  assertEquals(
    (res.body as { message: string }).message,
    "publicKeys must be a non-empty array of hex strings",
  );
});

// ---------------------------------------------------------------------------
// Non-array publicKeys returns 400
// ---------------------------------------------------------------------------

Deno.test("self balance - non-array publicKeys returns 400", async () => {
  const { ctx, getResponse } = createMockContext(
    { publicKeys: "not-an-array", channelContractId: "CTEST" },
    selfCustodialSession(testAddress()),
  );

  await postSelfBalanceHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 400);
  assertEquals(
    (res.body as { message: string }).message,
    "publicKeys must be a non-empty array of hex strings",
  );
});

// ---------------------------------------------------------------------------
// Missing publicKeys returns 400
// ---------------------------------------------------------------------------

Deno.test("self balance - missing publicKeys returns 400", async () => {
  const { ctx, getResponse } = createMockContext(
    { channelContractId: "CTEST" },
    selfCustodialSession(testAddress()),
  );

  await postSelfBalanceHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 400);
  assertEquals(
    (res.body as { message: string }).message,
    "publicKeys must be a non-empty array of hex strings",
  );
});

// ---------------------------------------------------------------------------
// Exceeding MAX_UTXO_SLOTS returns 400
// ---------------------------------------------------------------------------

Deno.test("self balance - exceeding MAX_UTXO_SLOTS returns 400", async () => {
  const keys = Array.from({ length: 301 }, () => dummyHexPubKey());

  const { ctx, getResponse } = createMockContext(
    { publicKeys: keys, channelContractId: "CTEST" },
    selfCustodialSession(testAddress()),
  );

  await postSelfBalanceHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 400);
  assertEquals(
    (res.body as { message: string }).message,
    "publicKeys array exceeds maximum of 300",
  );
});

// ---------------------------------------------------------------------------
// Single public key
// ---------------------------------------------------------------------------

Deno.test("self balance - single public key works", async () => {
  _setMockBalances([42_000n]);

  const pk = dummyHexPubKey();

  const { ctx, getResponse } = createMockContext(
    { publicKeys: [pk], channelContractId: "CTEST" },
    selfCustodialSession(testAddress()),
  );

  await postSelfBalanceHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 200);
  // deno-lint-ignore no-explicit-any
  const data = (res.body as { data: any }).data;
  assertEquals(data.totalBalance, "42000");
  assertEquals(data.utxoCount, 1);
  assertEquals(data.freeSlots, 299);
  assertEquals(data.utxos.length, 1);
  assertEquals(data.utxos[0].balance, "42000");

  _resetMockBalances();
});
