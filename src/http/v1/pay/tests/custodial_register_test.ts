/**
 * Integration tests for the custodial register handler.
 *
 * Uses PGlite (in-memory PostgreSQL via WASM) — real SQL, real transactions.
 * The generate-jwt module is mocked via deno.json import map.
 * Run with: deno test --allow-all --config src/http/v1/pay/tests/deno.json src/http/v1/pay/tests/custodial_register_test.ts
 */
import { assert, assertEquals } from "@std/assert";
import { StrKey } from "@colibri/core";
import { postCustodialRegisterHandler } from "@/http/v1/pay/custodial/register.ts";
import {
  createTestAccount,
  ensureInitialized,
  resetDb,
  testUsername,
} from "./test_helpers.ts";

// ---------------------------------------------------------------------------
// Mock Oak Context helper
// ---------------------------------------------------------------------------

type MockResponse = { status: number; body: unknown };

function createMockContext(
  body: unknown,
): {
  ctx: Parameters<typeof postCustodialRegisterHandler>[0];
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
    state: {},
  };

  return {
    // deno-lint-ignore no-explicit-any
    ctx: ctx as any,
    getResponse: () => ({ status: responseStatus, body: responseBody }),
  };
}

// ---------------------------------------------------------------------------
// Successful registration returns token + deposit address
// ---------------------------------------------------------------------------

Deno.test("custodial register - successful registration returns token and deposit address", async () => {
  await ensureInitialized();
  await resetDb();

  const username = testUsername();
  const { ctx, getResponse } = createMockContext({
    username,
    password: "secure-password-123",
  });

  await postCustodialRegisterHandler(ctx);
  const res = getResponse();

  assertEquals(
    res.status,
    200,
    `Expected 200 but got ${res.status}: ${JSON.stringify(res.body)}`,
  );
  assertEquals((res.body as { message: string }).message, "Account created");

  const data =
    (res.body as { data: { token: string; depositAddress: string } }).data;
  assert(data.token.length > 0, "Token should be non-empty");
  assert(
    data.token.startsWith("mock-jwt-custodial-"),
    "Token should come from mock JWT generator",
  );
  assert(
    StrKey.isValidEd25519PublicKey(data.depositAddress),
    "Deposit address should be a valid Stellar public key",
  );
});

// ---------------------------------------------------------------------------
// Duplicate username returns 400
// ---------------------------------------------------------------------------

Deno.test("custodial register - duplicate username returns 400", async () => {
  await ensureInitialized();
  await resetDb();

  const existing = await createTestAccount({});

  const { ctx, getResponse } = createMockContext({
    username: existing.username,
    password: "another-password-123",
  });

  await postCustodialRegisterHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 400);
  assertEquals(
    (res.body as { message: string }).message,
    "Registration failed",
  );
});

// ---------------------------------------------------------------------------
// Username too short (< 3 chars) returns 400
// ---------------------------------------------------------------------------

Deno.test("custodial register - username too short returns 400", async () => {
  await ensureInitialized();
  await resetDb();

  const { ctx, getResponse } = createMockContext({
    username: "ab",
    password: "secure-password-123",
  });

  await postCustodialRegisterHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 400);
  assertEquals(
    (res.body as { message: string }).message,
    "Username must be 3-50 characters",
  );
});

// ---------------------------------------------------------------------------
// Password too short (< 8 chars) returns 400
// ---------------------------------------------------------------------------

Deno.test("custodial register - password too short returns 400", async () => {
  await ensureInitialized();
  await resetDb();

  const { ctx, getResponse } = createMockContext({
    username: testUsername(),
    password: "short",
  });

  await postCustodialRegisterHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 400);
  assertEquals(
    (res.body as { message: string }).message,
    "Password must be at least 8 characters",
  );
});

// ---------------------------------------------------------------------------
// Missing fields return 400
// ---------------------------------------------------------------------------

Deno.test("custodial register - missing username returns 400", async () => {
  await ensureInitialized();
  await resetDb();

  const { ctx, getResponse } = createMockContext({
    password: "secure-password-123",
  });

  await postCustodialRegisterHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 400);
  assertEquals(
    (res.body as { message: string }).message,
    "username and password are required",
  );
});

Deno.test("custodial register - missing password returns 400", async () => {
  await ensureInitialized();
  await resetDb();

  const { ctx, getResponse } = createMockContext({
    username: testUsername(),
  });

  await postCustodialRegisterHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 400);
  assertEquals(
    (res.body as { message: string }).message,
    "username and password are required",
  );
});

Deno.test("custodial register - empty body returns 400", async () => {
  await ensureInitialized();
  await resetDb();

  const { ctx, getResponse } = createMockContext({});

  await postCustodialRegisterHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 400);
  assertEquals(
    (res.body as { message: string }).message,
    "username and password are required",
  );
});
