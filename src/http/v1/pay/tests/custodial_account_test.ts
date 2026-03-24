/**
 * Integration tests for the custodial account handler.
 *
 * Uses PGlite (in-memory PostgreSQL via WASM) — real SQL, real transactions.
 * Run with: deno test --allow-all --config src/http/v1/pay/tests/deno.json src/http/v1/pay/tests/custodial_account_test.ts
 */
import { assertEquals } from "jsr:@std/assert";
import { getCustodialAccountHandler } from "@/http/v1/pay/custodial/account.ts";
import {
  createTestAccount,
  resetDb,
  ensureInitialized,
  PayCustodialStatus,
} from "./test_helpers.ts";

// ---------------------------------------------------------------------------
// Mock Oak Context helper
// ---------------------------------------------------------------------------

type MockResponse = { status: number; body: unknown };

function createMockContext(
  session: unknown,
): {
  ctx: Parameters<typeof getCustodialAccountHandler>[0];
  getResponse: () => MockResponse;
} {
  let responseStatus = 200;
  let responseBody: unknown = undefined;

  const ctx = {
    request: {
      body: { json: () => Promise.resolve({}) },
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
// Returns account info for valid session
// ---------------------------------------------------------------------------

Deno.test("custodial account - returns account info for valid session", async () => {
  await ensureInitialized();
  await resetDb();

  const account = await createTestAccount({ balance: 5_000_000n });

  const { ctx, getResponse } = createMockContext(custodialSession(account.id));

  await getCustodialAccountHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 200, `Expected 200 but got ${res.status}: ${JSON.stringify(res.body)}`);
  assertEquals((res.body as { message: string }).message, "Account retrieved");

  const data = (res.body as { data: { id: string; depositAddress: string; balance: string; status: string } }).data;
  assertEquals(data.id, account.id);
  assertEquals(data.depositAddress, account.depositAddress);
  assertEquals(data.balance, "5000000");
  assertEquals(data.status, "active");
});

// ---------------------------------------------------------------------------
// Returns 404 for non-existent account
// ---------------------------------------------------------------------------

Deno.test("custodial account - returns 404 for non-existent account", async () => {
  await ensureInitialized();
  await resetDb();

  const fakeId = crypto.randomUUID();
  const { ctx, getResponse } = createMockContext(custodialSession(fakeId));

  await getCustodialAccountHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 404);
  assertEquals((res.body as { message: string }).message, "Account not found");
});

// ---------------------------------------------------------------------------
// Returns correct balance as string
// ---------------------------------------------------------------------------

Deno.test("custodial account - returns zero balance as '0'", async () => {
  await ensureInitialized();
  await resetDb();

  const account = await createTestAccount({ balance: 0n });

  const { ctx, getResponse } = createMockContext(custodialSession(account.id));

  await getCustodialAccountHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 200);
  const data = (res.body as { data: { balance: string } }).data;
  assertEquals(data.balance, "0");
});

Deno.test("custodial account - returns large balance as string", async () => {
  await ensureInitialized();
  await resetDb();

  const account = await createTestAccount({ balance: 999_999_999_999n });

  const { ctx, getResponse } = createMockContext(custodialSession(account.id));

  await getCustodialAccountHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 200);
  const data = (res.body as { data: { balance: string } }).data;
  assertEquals(data.balance, "999999999999");
});

// ---------------------------------------------------------------------------
// Reports correct status
// ---------------------------------------------------------------------------

Deno.test("custodial account - suspended account returns status 'suspended'", async () => {
  await ensureInitialized();
  await resetDb();

  const account = await createTestAccount({
    balance: 1000n,
    status: PayCustodialStatus.SUSPENDED,
  });

  const { ctx, getResponse } = createMockContext(custodialSession(account.id));

  await getCustodialAccountHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 200);
  const data = (res.body as { data: { status: string } }).data;
  assertEquals(data.status, "suspended");
});
