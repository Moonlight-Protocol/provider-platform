/**
 * Integration tests for the KYC GET handler.
 *
 * Uses PGlite (in-memory PostgreSQL via WASM) — real SQL, real transactions.
 * Run with: deno test --allow-all --config src/http/v1/pay/tests/deno.json src/http/v1/pay/tests/kyc_get_test.ts
 */
import { assertEquals } from "jsr:@std/assert";
import { getKycHandler } from "@/http/v1/pay/kyc/get.ts";
import {
  createTestKyc,
  testAddress,
  resetDb,
  ensureInitialized,
  PayKycStatus,
} from "./test_helpers.ts";

// ---------------------------------------------------------------------------
// Mock Oak Context helper
// The KYC GET handler reads ctx.params.address (set by Oak router).
// ---------------------------------------------------------------------------

type MockResponse = { status: number; body: unknown };

function createMockContext(
  params: { address?: string },
  session?: unknown,
): {
  ctx: Parameters<typeof getKycHandler>[0];
  getResponse: () => MockResponse;
} {
  let responseStatus = 200;
  let responseBody: unknown = undefined;

  const ctx = {
    params,
    request: {
      body: { json: () => Promise.resolve({}) },
    },
    response: {
      get status() { return responseStatus; },
      set status(s: number) { responseStatus = s; },
      get body() { return responseBody; },
      set body(b: unknown) { responseBody = b; },
    },
    state: { session: session ?? {} },
  };

  return {
    // deno-lint-ignore no-explicit-any
    ctx: ctx as any,
    getResponse: () => ({ status: responseStatus, body: responseBody }),
  };
}

// ---------------------------------------------------------------------------
// Returns KYC status for existing address
// ---------------------------------------------------------------------------

Deno.test("kyc get - returns VERIFIED status for verified address", async () => {
  await ensureInitialized();
  await resetDb();

  const address = testAddress();
  await createTestKyc(address, PayKycStatus.VERIFIED);

  const { ctx, getResponse } = createMockContext({ address }, { sub: address });

  await getKycHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 200, `Expected 200 but got ${res.status}: ${JSON.stringify(res.body)}`);
  assertEquals((res.body as { message: string }).message, "KYC status retrieved");

  const data = (res.body as { data: { status: string; jurisdiction: string | null } }).data;
  assertEquals(data.status, PayKycStatus.VERIFIED);
  assertEquals(data.jurisdiction, "US");
});

Deno.test("kyc get - returns PENDING status for pending address", async () => {
  await ensureInitialized();
  await resetDb();

  const address = testAddress();
  await createTestKyc(address, PayKycStatus.PENDING);

  const { ctx, getResponse } = createMockContext({ address }, { sub: address });

  await getKycHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 200);
  const data = (res.body as { data: { status: string; jurisdiction: string | null } }).data;
  assertEquals(data.status, PayKycStatus.PENDING);
  assertEquals(data.jurisdiction, null);
});

// ---------------------------------------------------------------------------
// Returns "NONE" for address with no KYC record
// ---------------------------------------------------------------------------

Deno.test("kyc get - returns NONE for address with no KYC record", async () => {
  await ensureInitialized();
  await resetDb();

  const address = testAddress();
  const { ctx, getResponse } = createMockContext({ address }, { sub: address });

  await getKycHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 200);
  const data = (res.body as { data: { status: string; jurisdiction: string | null } }).data;
  assertEquals(data.status, "NONE");
  assertEquals(data.jurisdiction, null);
});

// ---------------------------------------------------------------------------
// Missing address returns 400
// ---------------------------------------------------------------------------

Deno.test("kyc get - missing address returns 400", async () => {
  await ensureInitialized();
  await resetDb();

  const { ctx, getResponse } = createMockContext({});

  await getKycHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 400);
  assertEquals((res.body as { message: string }).message, "Address is required");
});

Deno.test("kyc get - undefined params returns 400", async () => {
  await ensureInitialized();
  await resetDb();

  // Simulate no params at all (handler casts ctx to get params)
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
    state: { session: {} },
  };

  // deno-lint-ignore no-explicit-any
  await getKycHandler(ctx as any);

  assertEquals(responseStatus, 400);
  assertEquals((responseBody as { message: string }).message, "Address is required");
});
