/**
 * Integration tests for the transactions list handler.
 *
 * Uses PGlite (in-memory PostgreSQL via WASM) — real SQL, real transactions.
 * Run with: deno test --allow-all --config src/http/v1/pay/tests/deno.json src/http/v1/pay/tests/transactions_list_test.ts
 */
import { assertEquals } from "jsr:@std/assert";
import { listTransactionsHandler } from "@/http/v1/pay/transactions/list.ts";
import {
  createTestAccount,
  createTestTransaction,
  testAddress,
  resetDb,
  ensureInitialized,
  PayTransactionType,
  PayTransactionStatus,
} from "./test_helpers.ts";

// ---------------------------------------------------------------------------
// Mock Oak Context helper
// The transactions list handler reads searchParams from ctx.request.url
// ---------------------------------------------------------------------------

type MockResponse = { status: number; body: unknown };

function createMockContext(
  session: unknown,
  searchParams?: Record<string, string>,
): {
  ctx: Parameters<typeof listTransactionsHandler>[0];
  getResponse: () => MockResponse;
} {
  let responseStatus = 200;
  let responseBody: unknown = undefined;

  const url = new URL("http://localhost/pay/transactions");
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      url.searchParams.set(key, value);
    }
  }

  const ctx = {
    request: {
      body: { json: () => Promise.resolve({}) },
      url,
    },
    response: {
      get status() { return responseStatus; },
      set status(s: number) { responseStatus = s; },
      get body() { return responseBody; },
      set body(b: unknown) { responseBody = b; },
    },
    state: { session },
  };

  return {
    // deno-lint-ignore no-explicit-any
    ctx: ctx as any,
    getResponse: () => ({ status: responseStatus, body: responseBody }),
  };
}

function custodialSession(accountId: string) {
  return {
    iss: "https://localhost",
    sub: accountId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    sessionId: crypto.randomUUID(),
    type: "custodial" as const,
  };
}

// ---------------------------------------------------------------------------
// Returns transactions for account
// ---------------------------------------------------------------------------

Deno.test("transactions list - returns transactions for account", async () => {
  await ensureInitialized();
  await resetDb();

  const account = await createTestAccount({ balance: 10_000_000n });
  const receiver = testAddress();

  await createTestTransaction({
    accountId: account.id,
    type: PayTransactionType.SEND,
    status: PayTransactionStatus.COMPLETED,
    amount: 5_000_000n,
    toAddress: receiver,
  });
  await createTestTransaction({
    accountId: account.id,
    type: PayTransactionType.RECEIVE,
    status: PayTransactionStatus.PENDING,
    amount: 2_000_000n,
    fromAddress: testAddress(),
  });

  const { ctx, getResponse } = createMockContext(custodialSession(account.id));

  await listTransactionsHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 200, `Expected 200 but got ${res.status}: ${JSON.stringify(res.body)}`);
  assertEquals((res.body as { message: string }).message, "Transactions retrieved");

  // deno-lint-ignore no-explicit-any
  const data = (res.body as { data: any }).data;
  assertEquals(data.transactions.length, 2);
  assertEquals(data.total, 2);
});

// ---------------------------------------------------------------------------
// Pagination (limit/offset) works
// ---------------------------------------------------------------------------

Deno.test("transactions list - pagination limit works", async () => {
  await ensureInitialized();
  await resetDb();

  const account = await createTestAccount({ balance: 10_000_000n });

  // Create 5 transactions
  for (let i = 0; i < 5; i++) {
    await createTestTransaction({
      accountId: account.id,
      amount: BigInt((i + 1) * 1000),
    });
  }

  const { ctx, getResponse } = createMockContext(
    custodialSession(account.id),
    { limit: "2" },
  );

  await listTransactionsHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 200);
  // deno-lint-ignore no-explicit-any
  const data = (res.body as { data: any }).data;
  assertEquals(data.transactions.length, 2, "Should return only 2 items with limit=2");
  assertEquals(data.total, 5, "Total should still be 5");
});

Deno.test("transactions list - pagination offset works", async () => {
  await ensureInitialized();
  await resetDb();

  const account = await createTestAccount({ balance: 10_000_000n });

  for (let i = 0; i < 5; i++) {
    await createTestTransaction({
      accountId: account.id,
      amount: BigInt((i + 1) * 1000),
    });
  }

  const { ctx, getResponse } = createMockContext(
    custodialSession(account.id),
    { limit: "2", offset: "3" },
  );

  await listTransactionsHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 200);
  // deno-lint-ignore no-explicit-any
  const data = (res.body as { data: any }).data;
  assertEquals(data.transactions.length, 2, "Should return 2 items starting from offset 3");
});

// ---------------------------------------------------------------------------
// Status filter works
// ---------------------------------------------------------------------------

Deno.test("transactions list - status filter returns only matching transactions", async () => {
  await ensureInitialized();
  await resetDb();

  const account = await createTestAccount({ balance: 10_000_000n });

  await createTestTransaction({
    accountId: account.id,
    status: PayTransactionStatus.COMPLETED,
    amount: 1000n,
  });
  await createTestTransaction({
    accountId: account.id,
    status: PayTransactionStatus.PENDING,
    amount: 2000n,
  });
  await createTestTransaction({
    accountId: account.id,
    status: PayTransactionStatus.COMPLETED,
    amount: 3000n,
  });

  const { ctx, getResponse } = createMockContext(
    custodialSession(account.id),
    { status: "PENDING" },
  );

  await listTransactionsHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 200);
  // deno-lint-ignore no-explicit-any
  const data = (res.body as { data: any }).data;
  assertEquals(data.transactions.length, 1, "Should return only PENDING transactions");
  assertEquals(data.transactions[0].status, "pending");
});

// ---------------------------------------------------------------------------
// Invalid status returns 400
// ---------------------------------------------------------------------------

Deno.test("transactions list - invalid status returns 400", async () => {
  await ensureInitialized();
  await resetDb();

  const account = await createTestAccount({ balance: 10_000_000n });

  const { ctx, getResponse } = createMockContext(
    custodialSession(account.id),
    { status: "INVALID_STATUS" },
  );

  await listTransactionsHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 400);
  const msg = (res.body as { message: string }).message;
  assertEquals(msg.startsWith("Invalid status"), true, `Expected message to start with 'Invalid status', got: ${msg}`);
});

// ---------------------------------------------------------------------------
// Empty result returns empty array
// ---------------------------------------------------------------------------

Deno.test("transactions list - empty result returns empty array", async () => {
  await ensureInitialized();
  await resetDb();

  const account = await createTestAccount({ balance: 0n });

  const { ctx, getResponse } = createMockContext(custodialSession(account.id));

  await listTransactionsHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 200);
  // deno-lint-ignore no-explicit-any
  const data = (res.body as { data: any }).data;
  assertEquals(data.transactions.length, 0);
  assertEquals(data.total, 0);
});

// ---------------------------------------------------------------------------
// Transaction data shape
// ---------------------------------------------------------------------------

Deno.test("transactions list - returns correct transaction data shape", async () => {
  await ensureInitialized();
  await resetDb();

  const account = await createTestAccount({ balance: 10_000_000n });
  const receiver = testAddress();

  await createTestTransaction({
    accountId: account.id,
    type: PayTransactionType.SEND,
    status: PayTransactionStatus.COMPLETED,
    amount: 5_000_000n,
    toAddress: receiver,
  });

  const { ctx, getResponse } = createMockContext(custodialSession(account.id));

  await listTransactionsHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 200);
  // deno-lint-ignore no-explicit-any
  const tx = (res.body as { data: any }).data.transactions[0];
  assertEquals(tx.type, "send");
  assertEquals(tx.status, "completed");
  assertEquals(tx.amount, "5000000");
  assertEquals(tx.assetCode, "XLM");
  assertEquals(tx.to, receiver);
  assertEquals(typeof tx.createdAt, "string", "createdAt should be ISO string");
  assertEquals(typeof tx.updatedAt, "string", "updatedAt should be ISO string");
});
