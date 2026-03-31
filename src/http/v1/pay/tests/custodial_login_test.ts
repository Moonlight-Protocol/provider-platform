/**
 * Integration tests for the custodial login handler.
 *
 * Uses PGlite (in-memory PostgreSQL via WASM) — real SQL, real transactions.
 * The generate-jwt module is mocked via deno.json import map.
 * Run with: deno test --allow-all --config src/http/v1/pay/tests/deno.json src/http/v1/pay/tests/custodial_login_test.ts
 */
import { assertEquals, assert } from "jsr:@std/assert";
import { postCustodialLoginHandler } from "@/http/v1/pay/custodial/login.ts";
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
  body: unknown,
): {
  ctx: Parameters<typeof postCustodialLoginHandler>[0];
  getResponse: () => MockResponse;
} {
  let responseStatus = 200;
  let responseBody: unknown = undefined;

  const ctx = {
    request: {
      body: { json: () => Promise.resolve(body) },
    },
    response: {
      get status() { return responseStatus; },
      set status(s: number) { responseStatus = s; },
      get body() { return responseBody; },
      set body(b: unknown) { responseBody = b; },
    },
    state: {},
  };

  return {
    // deno-lint-ignore no-explicit-any
    ctx: ctx as any,
    getResponse: () => ({ status: responseStatus, body: responseBody }),
  };
}

// ---------------------------------------------------------------------------
// Valid login returns 200 + token
// ---------------------------------------------------------------------------

Deno.test("custodial login - valid login returns 200 and token", async () => {
  await ensureInitialized();
  await resetDb();

  const password = "secure-password-123";
  const account = await createTestAccount({ password });

  const { ctx, getResponse } = createMockContext({
    username: account.username,
    password,
  });

  await postCustodialLoginHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 200, `Expected 200 but got ${res.status}: ${JSON.stringify(res.body)}`);
  assertEquals((res.body as { message: string }).message, "Login successful");

  const data = (res.body as { data: { token: string } }).data;
  assert(data.token.length > 0, "Token should be non-empty");
  assert(data.token.startsWith("mock-jwt-custodial-"), "Token should come from mock JWT generator");
});

// ---------------------------------------------------------------------------
// Wrong password returns 401
// ---------------------------------------------------------------------------

Deno.test("custodial login - wrong password returns 401", async () => {
  await ensureInitialized();
  await resetDb();

  const account = await createTestAccount({ password: "correct-password-123" });

  const { ctx, getResponse } = createMockContext({
    username: account.username,
    password: "wrong-password-123",
  });

  await postCustodialLoginHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 401);
  assertEquals((res.body as { message: string }).message, "Invalid credentials");
});

// ---------------------------------------------------------------------------
// Non-existent username returns 401 (no enumeration)
// ---------------------------------------------------------------------------

Deno.test("custodial login - non-existent username returns 401", async () => {
  await ensureInitialized();
  await resetDb();

  const { ctx, getResponse } = createMockContext({
    username: "nonexistent_user",
    password: "some-password-123",
  });

  await postCustodialLoginHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 401);
  assertEquals(
    (res.body as { message: string }).message,
    "Invalid credentials",
    "Should return same message as wrong password to prevent user enumeration",
  );
});

// ---------------------------------------------------------------------------
// Suspended account returns 403
// ---------------------------------------------------------------------------

Deno.test("custodial login - suspended account returns 401 (same as invalid credentials)", async () => {
  await ensureInitialized();
  await resetDb();

  const password = "secure-password-123";
  const account = await createTestAccount({
    password,
    status: PayCustodialStatus.SUSPENDED,
  });

  const { ctx, getResponse } = createMockContext({
    username: account.username,
    password,
  });

  await postCustodialLoginHandler(ctx);
  const res = getResponse();

  // Suspended accounts get the same response as invalid credentials
  // to avoid confirming the password is correct
  assertEquals(res.status, 401);
  assertEquals((res.body as { message: string }).message, "Invalid credentials");
});

// ---------------------------------------------------------------------------
// Missing username/password returns 400
// ---------------------------------------------------------------------------

Deno.test("custodial login - missing username returns 400", async () => {
  await ensureInitialized();
  await resetDb();

  const { ctx, getResponse } = createMockContext({
    password: "some-password-123",
  });

  await postCustodialLoginHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 400);
  assertEquals((res.body as { message: string }).message, "username and password are required");
});

Deno.test("custodial login - missing password returns 400", async () => {
  await ensureInitialized();
  await resetDb();

  const { ctx, getResponse } = createMockContext({
    username: "some_user",
  });

  await postCustodialLoginHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 400);
  assertEquals((res.body as { message: string }).message, "username and password are required");
});

Deno.test("custodial login - empty body returns 400", async () => {
  await ensureInitialized();
  await resetDb();

  const { ctx, getResponse } = createMockContext({});

  await postCustodialLoginHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 400);
  assertEquals((res.body as { message: string }).message, "username and password are required");
});
