/**
 * Integration tests for the custodial send handler.
 *
 * Uses PGlite (in-memory PostgreSQL via WASM) — real SQL, real transactions.
 * Run with: deno test --allow-all --config src/http/v1/pay/tests/deno.json src/http/v1/pay/tests/custodial_send_test.ts
 */
import { assertEquals, assertExists } from "@std/assert";
import { postCustodialSendHandler } from "@/http/v1/pay/custodial/send.ts";
import {
  createTestAccount,
  createTestKyc,
  ensureInitialized,
  getAccount,
  getAllEscrows,
  getAllTransactions,
  PayCustodialStatus,
  PayEscrowStatus,
  PayKycStatus,
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
  ctx: Parameters<typeof postCustodialSendHandler>[0];
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

function sep10Session(accountId: string) {
  return {
    iss: "https://localhost",
    sub: accountId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    sessionId: crypto.randomUUID(),
    type: "sep10" as const,
  };
}

// ---------------------------------------------------------------------------
// Successful send
// ---------------------------------------------------------------------------

Deno.test("custodial send - successful send debits balance and creates SEND transaction", async () => {
  await ensureInitialized();
  await resetDb();

  const receiverAddress = testAddress();
  const account = await createTestAccount({ balance: 10_000_000n });
  await createTestKyc(receiverAddress, PayKycStatus.VERIFIED);

  const { ctx, getResponse } = createMockContext(
    { to: receiverAddress, amount: "5000000" },
    custodialSession(account.id),
  );

  await postCustodialSendHandler(ctx);
  const res = getResponse();

  assertEquals(
    res.status,
    200,
    `Expected 200 but got ${res.status}: ${JSON.stringify(res.body)}`,
  );

  const updatedAccount = await getAccount(account.id);
  assertEquals(updatedAccount?.balance, 5_000_000n);

  const txs = (await getAllTransactions()).filter((t) =>
    t.accountId === account.id
  );
  assertEquals(txs.length, 1);
  assertEquals(txs[0].type, PayTransactionType.SEND);
  assertEquals(txs[0].amount, 5_000_000n);
  assertEquals(txs[0].toAddress, receiverAddress);
});

// ---------------------------------------------------------------------------
// Send to unverified address creates escrow
// ---------------------------------------------------------------------------

Deno.test("custodial send - send to unverified address creates escrow", async () => {
  await ensureInitialized();
  await resetDb();

  const receiverAddress = testAddress();
  const account = await createTestAccount({ balance: 10_000_000n });

  const { ctx, getResponse } = createMockContext(
    { to: receiverAddress, amount: "5000000" },
    custodialSession(account.id),
  );

  await postCustodialSendHandler(ctx);
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
  assertEquals(escrows[0].mode, "custodial");
});

// ---------------------------------------------------------------------------
// Insufficient balance
// ---------------------------------------------------------------------------

Deno.test("custodial send - insufficient balance returns 400", async () => {
  await ensureInitialized();
  await resetDb();
  const account = await createTestAccount({ balance: 1000n });

  const { ctx, getResponse } = createMockContext(
    { to: testAddress(), amount: "5000" },
    custodialSession(account.id),
  );

  await postCustodialSendHandler(ctx);

  assertEquals(getResponse().status, 400);
  assertEquals(
    (getResponse().body as { message: string }).message,
    "Insufficient balance",
  );
  assertEquals((await getAccount(account.id))?.balance, 1000n);
});

// ---------------------------------------------------------------------------
// Suspended account
// ---------------------------------------------------------------------------

Deno.test("custodial send - suspended account returns 403", async () => {
  await ensureInitialized();
  await resetDb();
  const account = await createTestAccount({
    balance: 10_000_000n,
    status: PayCustodialStatus.SUSPENDED,
  });

  const { ctx, getResponse } = createMockContext(
    { to: testAddress(), amount: "5000000" },
    custodialSession(account.id),
  );

  await postCustodialSendHandler(ctx);

  assertEquals(getResponse().status, 403);
  assertEquals(
    (getResponse().body as { message: string }).message,
    "Account suspended",
  );
});

// ---------------------------------------------------------------------------
// Non-custodial JWT type
// ---------------------------------------------------------------------------

Deno.test("custodial send - non-custodial JWT type returns 403", async () => {
  await ensureInitialized();
  await resetDb();
  const account = await createTestAccount({ balance: 10_000_000n });

  const { ctx, getResponse } = createMockContext(
    { to: testAddress(), amount: "5000000" },
    sep10Session(account.id),
  );

  await postCustodialSendHandler(ctx);

  assertEquals(getResponse().status, 403);
  assertEquals(
    (getResponse().body as { message: string }).message,
    "Custodial authentication required",
  );
});

// ---------------------------------------------------------------------------
// Concurrent sends don't double-spend (CRITICAL)
// ---------------------------------------------------------------------------

Deno.test("custodial send - concurrent sends don't double-spend", async () => {
  await ensureInitialized();
  await resetDb();

  const receiverAddress = testAddress();
  const account = await createTestAccount({ balance: 10_000_000n });
  await createTestKyc(receiverAddress, PayKycStatus.VERIFIED);

  const results = await Promise.allSettled([
    (async () => {
      const { ctx, getResponse } = createMockContext(
        { to: receiverAddress, amount: "10000000" },
        custodialSession(account.id),
      );
      await postCustodialSendHandler(ctx);
      return getResponse();
    })(),
    (async () => {
      const { ctx, getResponse } = createMockContext(
        { to: receiverAddress, amount: "10000000" },
        custodialSession(account.id),
      );
      await postCustodialSendHandler(ctx);
      return getResponse();
    })(),
  ]);

  const responses = results
    .filter((r) => r.status === "fulfilled")
    .map((r) => (r as PromiseFulfilledResult<MockResponse>).value);

  assertEquals(responses.length, 2, "Both requests should complete");

  const successes = responses.filter((r) => r.status === 200);
  const failures = responses.filter((r) => r.status === 400);

  assertEquals(
    successes.length,
    1,
    `Expected exactly 1 success, got ${successes.length}`,
  );
  assertEquals(
    failures.length,
    1,
    `Expected exactly 1 failure, got ${failures.length}`,
  );
  assertEquals(
    (failures[0].body as { message: string }).message,
    "Insufficient balance",
  );
  assertEquals(
    (await getAccount(account.id))?.balance,
    0n,
    "Balance must be exactly 0n",
  );

  const txs = (await getAllTransactions()).filter((t) =>
    t.accountId === account.id
  );
  assertEquals(txs.length, 1, "Exactly one SEND transaction should exist");
});

// ---------------------------------------------------------------------------
// Invalid amounts
// ---------------------------------------------------------------------------

Deno.test("custodial send - invalid amount 'abc' returns 400", async () => {
  await ensureInitialized();
  await resetDb();
  const account = await createTestAccount({ balance: 10_000_000n });
  const { ctx, getResponse } = createMockContext({
    to: testAddress(),
    amount: "abc",
  }, custodialSession(account.id));
  await postCustodialSendHandler(ctx);
  assertEquals(getResponse().status, 400);
});

Deno.test("custodial send - invalid amount '-1' returns 400", async () => {
  await ensureInitialized();
  await resetDb();
  const account = await createTestAccount({ balance: 10_000_000n });
  const { ctx, getResponse } = createMockContext({
    to: testAddress(),
    amount: "-1",
  }, custodialSession(account.id));
  await postCustodialSendHandler(ctx);
  assertEquals(getResponse().status, 400);
});

Deno.test("custodial send - invalid amount '1.5' returns 400", async () => {
  await ensureInitialized();
  await resetDb();
  const account = await createTestAccount({ balance: 10_000_000n });
  const { ctx, getResponse } = createMockContext({
    to: testAddress(),
    amount: "1.5",
  }, custodialSession(account.id));
  await postCustodialSendHandler(ctx);
  assertEquals(getResponse().status, 400);
});

Deno.test("custodial send - invalid amount '' returns 400", async () => {
  await ensureInitialized();
  await resetDb();
  const account = await createTestAccount({ balance: 10_000_000n });
  const { ctx, getResponse } = createMockContext({
    to: testAddress(),
    amount: "",
  }, custodialSession(account.id));
  await postCustodialSendHandler(ctx);
  assertEquals(getResponse().status, 400);
});

// ---------------------------------------------------------------------------
// Invalid `to` address
// ---------------------------------------------------------------------------

Deno.test("custodial send - invalid to address returns 400", async () => {
  await ensureInitialized();
  await resetDb();
  const account = await createTestAccount({ balance: 10_000_000n });
  const { ctx, getResponse } = createMockContext({
    to: "not-an-address",
    amount: "5000000",
  }, custodialSession(account.id));
  await postCustodialSendHandler(ctx);
  assertEquals(getResponse().status, 400);
  assertEquals(
    (getResponse().body as { message: string }).message,
    "to must be a valid Stellar public key (G...)",
  );
});

// ---------------------------------------------------------------------------
// Missing fields
// ---------------------------------------------------------------------------

Deno.test("custodial send - missing 'to' field returns 400", async () => {
  await ensureInitialized();
  await resetDb();
  const account = await createTestAccount({ balance: 10_000_000n });
  const { ctx, getResponse } = createMockContext(
    { amount: "5000000" },
    custodialSession(account.id),
  );
  await postCustodialSendHandler(ctx);
  assertEquals(getResponse().status, 400);
});

Deno.test("custodial send - missing 'amount' field returns 400", async () => {
  await ensureInitialized();
  await resetDb();
  const account = await createTestAccount({ balance: 10_000_000n });
  const { ctx, getResponse } = createMockContext(
    { to: testAddress() },
    custodialSession(account.id),
  );
  await postCustodialSendHandler(ctx);
  assertEquals(getResponse().status, 400);
});

// ---------------------------------------------------------------------------
// Zero amount
// ---------------------------------------------------------------------------

Deno.test("custodial send - zero amount returns 400", async () => {
  await ensureInitialized();
  await resetDb();
  const account = await createTestAccount({ balance: 10_000_000n });
  const { ctx, getResponse } = createMockContext({
    to: testAddress(),
    amount: "0",
  }, custodialSession(account.id));
  await postCustodialSendHandler(ctx);
  assertEquals(getResponse().status, 400);
  assertEquals(
    (getResponse().body as { message: string }).message,
    "Amount must be positive",
  );
});
