/**
 * Integration tests for the self-custodial send handler.
 *
 * Uses PGlite (in-memory PostgreSQL via WASM) — real SQL, real transactions.
 * Run with: deno test --allow-all --config src/http/v1/pay/tests/deno.json src/http/v1/pay/tests/self_send_test.ts
 */
import { assertEquals, assertExists } from "@std/assert";
import { postSelfSendHandler } from "@/http/v1/pay/self/send.ts";
import {
  createTestKyc,
  ensureInitialized,
  getAllEscrows,
  getAllTransactions,
  PayEscrowStatus,
  PayKycStatus,
  PayTransactionStatus,
  PayTransactionType,
  resetDb,
  testAddress,
} from "./test_helpers.ts";

// ---------------------------------------------------------------------------
// Mock Oak Context helper
// ---------------------------------------------------------------------------

type MockResponse = { status: number; body: unknown };

function createMockContext(
  body: unknown,
  session: unknown,
): {
  ctx: Parameters<typeof postSelfSendHandler>[0];
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

// ---------------------------------------------------------------------------
// Successful send to verified address
// ---------------------------------------------------------------------------

Deno.test("self send - successful send to verified address creates SEND transaction with status PENDING", async () => {
  await ensureInitialized();
  await resetDb();

  const senderAddress = testAddress();
  const receiverAddress = testAddress();
  await createTestKyc(receiverAddress, PayKycStatus.VERIFIED);

  const { ctx, getResponse } = createMockContext(
    { to: receiverAddress, amount: "5000000" },
    selfCustodialSession(senderAddress),
  );

  await postSelfSendHandler(ctx);
  const res = getResponse();

  assertEquals(
    res.status,
    200,
    `Expected 200 but got ${res.status}: ${JSON.stringify(res.body)}`,
  );
  const data = (res.body as { data: { status: string } }).data;
  assertEquals(data.status, "pending");

  const txs = (await getAllTransactions()).filter((t) =>
    t.accountId === senderAddress
  );
  assertEquals(txs.length, 1);
  assertEquals(txs[0].type, PayTransactionType.SEND);
  assertEquals(txs[0].status, PayTransactionStatus.PENDING);
  assertEquals(txs[0].amount, 5_000_000n);
  assertEquals(txs[0].toAddress, receiverAddress);
  assertEquals(txs[0].mode, "self");
});

// ---------------------------------------------------------------------------
// Send to unverified address creates escrow
// ---------------------------------------------------------------------------

Deno.test("self send - send to unverified address creates escrow", async () => {
  await ensureInitialized();
  await resetDb();

  const senderAddress = testAddress();
  const receiverAddress = testAddress();

  const { ctx, getResponse } = createMockContext(
    { to: receiverAddress, amount: "5000000" },
    selfCustodialSession(senderAddress),
  );

  await postSelfSendHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 200);
  const data =
    (res.body as { data: { escrowId?: string; status?: string } }).data;
  assertExists(data.escrowId, "Response should contain an escrowId");
  assertEquals(data.status, "escrowed");

  const escrows = (await getAllEscrows()).filter((e) =>
    e.heldForAddress === receiverAddress
  );
  assertEquals(escrows.length, 1);
  assertEquals(escrows[0].status, PayEscrowStatus.HELD);
  assertEquals(escrows[0].amount, 5_000_000n);
  assertEquals(escrows[0].mode, "self");

  // Transaction should also be created with COMPLETED status (escrow path)
  const txs = (await getAllTransactions()).filter((t) =>
    t.accountId === senderAddress
  );
  assertEquals(txs.length, 1);
  assertEquals(txs[0].status, PayTransactionStatus.COMPLETED);
});

// ---------------------------------------------------------------------------
// Invalid amount returns 400
// ---------------------------------------------------------------------------

Deno.test("self send - invalid amount 'abc' returns 400", async () => {
  await ensureInitialized();
  await resetDb();
  const { ctx, getResponse } = createMockContext(
    { to: testAddress(), amount: "abc" },
    selfCustodialSession(testAddress()),
  );
  await postSelfSendHandler(ctx);
  assertEquals(getResponse().status, 400);
});

Deno.test("self send - invalid amount '-1' returns 400", async () => {
  await ensureInitialized();
  await resetDb();
  const { ctx, getResponse } = createMockContext(
    { to: testAddress(), amount: "-1" },
    selfCustodialSession(testAddress()),
  );
  await postSelfSendHandler(ctx);
  assertEquals(getResponse().status, 400);
});

Deno.test("self send - invalid amount '1.5' returns 400", async () => {
  await ensureInitialized();
  await resetDb();
  const { ctx, getResponse } = createMockContext(
    { to: testAddress(), amount: "1.5" },
    selfCustodialSession(testAddress()),
  );
  await postSelfSendHandler(ctx);
  assertEquals(getResponse().status, 400);
});

// ---------------------------------------------------------------------------
// Invalid to address returns 400
// ---------------------------------------------------------------------------

Deno.test("self send - invalid to address returns 400", async () => {
  await ensureInitialized();
  await resetDb();
  const { ctx, getResponse } = createMockContext(
    { to: "not-an-address", amount: "5000000" },
    selfCustodialSession(testAddress()),
  );
  await postSelfSendHandler(ctx);
  assertEquals(getResponse().status, 400);
  assertEquals(
    (getResponse().body as { message: string }).message,
    "to must be a valid Stellar public key (G...)",
  );
});

// ---------------------------------------------------------------------------
// Missing fields return 400
// ---------------------------------------------------------------------------

Deno.test("self send - missing 'to' field returns 400", async () => {
  await ensureInitialized();
  await resetDb();
  const { ctx, getResponse } = createMockContext(
    { amount: "5000000" },
    selfCustodialSession(testAddress()),
  );
  await postSelfSendHandler(ctx);
  assertEquals(getResponse().status, 400);
  assertEquals(
    (getResponse().body as { message: string }).message,
    "to and amount are required",
  );
});

Deno.test("self send - missing 'amount' field returns 400", async () => {
  await ensureInitialized();
  await resetDb();
  const { ctx, getResponse } = createMockContext(
    { to: testAddress() },
    selfCustodialSession(testAddress()),
  );
  await postSelfSendHandler(ctx);
  assertEquals(getResponse().status, 400);
  assertEquals(
    (getResponse().body as { message: string }).message,
    "to and amount are required",
  );
});

// ---------------------------------------------------------------------------
// Zero amount returns 400
// ---------------------------------------------------------------------------

Deno.test("self send - zero amount returns 400", async () => {
  await ensureInitialized();
  await resetDb();
  const { ctx, getResponse } = createMockContext(
    { to: testAddress(), amount: "0" },
    selfCustodialSession(testAddress()),
  );
  await postSelfSendHandler(ctx);
  assertEquals(getResponse().status, 400);
  assertEquals(
    (getResponse().body as { message: string }).message,
    "Amount must be positive",
  );
});
