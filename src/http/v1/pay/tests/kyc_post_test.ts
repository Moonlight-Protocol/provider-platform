/**
 * Integration tests for the KYC POST handler.
 *
 * Uses PGlite (in-memory PostgreSQL via WASM) — real SQL, real transactions.
 * Run with: deno test --allow-all --config src/http/v1/pay/tests/deno.json src/http/v1/pay/tests/kyc_post_test.ts
 */
import { assertEquals } from "jsr:@std/assert";
import { postKycHandler } from "@/http/v1/pay/kyc/post.ts";
import {
  createTestAccount,
  createTestKyc,
  testAddress,
  resetDb,
  ensureInitialized,
  getAllKyc,
  PayKycStatus,
} from "./test_helpers.ts";

// ---------------------------------------------------------------------------
// Mock Oak Context helper
// ---------------------------------------------------------------------------

type MockResponse = { status: number; body: unknown };

function createMockContext(
  body: unknown,
  session: unknown,
): {
  ctx: Parameters<typeof postKycHandler>[0];
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
// Self-custodial user submits KYC for own address — 200
// ---------------------------------------------------------------------------

Deno.test("kyc post - self-custodial user submits KYC for own address returns 200", async () => {
  await ensureInitialized();
  await resetDb();

  const address = testAddress();

  const { ctx, getResponse } = createMockContext(
    { address, jurisdiction: "US" },
    selfCustodialSession(address),
  );

  await postKycHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 200, `Expected 200 but got ${res.status}: ${JSON.stringify(res.body)}`);
  assertEquals((res.body as { message: string }).message, "KYC submitted");
  assertEquals((res.body as { data: { status: string } }).data.status, PayKycStatus.PENDING);

  const kycRecords = await getAllKyc();
  const record = kycRecords.find((k) => k.address === address);
  assertEquals(record?.status, PayKycStatus.PENDING);
  assertEquals(record?.jurisdiction, "US");
});

// ---------------------------------------------------------------------------
// Self-custodial user submits KYC for different address — 403
// ---------------------------------------------------------------------------

Deno.test("kyc post - self-custodial user submits KYC for different address returns 403", async () => {
  await ensureInitialized();
  await resetDb();

  const ownAddress = testAddress();
  const otherAddress = testAddress();

  const { ctx, getResponse } = createMockContext(
    { address: otherAddress, jurisdiction: "US" },
    selfCustodialSession(ownAddress),
  );

  await postKycHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 403);
  assertEquals(
    (res.body as { message: string }).message,
    "Address does not match authenticated account",
  );
});

// ---------------------------------------------------------------------------
// Custodial user submits KYC for own deposit address — 200
// ---------------------------------------------------------------------------

Deno.test("kyc post - custodial user submits KYC for own deposit address returns 200", async () => {
  await ensureInitialized();
  await resetDb();

  const account = await createTestAccount({});

  const { ctx, getResponse } = createMockContext(
    { address: account.depositAddress, jurisdiction: "EU" },
    custodialSession(account.id),
  );

  await postKycHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 200, `Expected 200 but got ${res.status}: ${JSON.stringify(res.body)}`);
  assertEquals((res.body as { message: string }).message, "KYC submitted");

  const kycRecords = await getAllKyc();
  const record = kycRecords.find((k) => k.address === account.depositAddress);
  assertEquals(record?.status, PayKycStatus.PENDING);
  assertEquals(record?.jurisdiction, "EU");
});

// ---------------------------------------------------------------------------
// Custodial user submits KYC for wrong address — 403
// ---------------------------------------------------------------------------

Deno.test("kyc post - custodial user submits KYC for wrong address returns 403", async () => {
  await ensureInitialized();
  await resetDb();

  const account = await createTestAccount({});
  const wrongAddress = testAddress();

  const { ctx, getResponse } = createMockContext(
    { address: wrongAddress, jurisdiction: "US" },
    custodialSession(account.id),
  );

  await postKycHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 403);
  assertEquals(
    (res.body as { message: string }).message,
    "Address does not belong to this account",
  );
});

// ---------------------------------------------------------------------------
// Creates new KYC record if none exists
// ---------------------------------------------------------------------------

Deno.test("kyc post - creates new KYC record if none exists", async () => {
  await ensureInitialized();
  await resetDb();

  const address = testAddress();

  const { ctx, getResponse } = createMockContext(
    { address, jurisdiction: "JP" },
    selfCustodialSession(address),
  );

  await postKycHandler(ctx);

  assertEquals(getResponse().status, 200);

  const kycRecords = await getAllKyc();
  assertEquals(kycRecords.length, 1);
  assertEquals(kycRecords[0].address, address);
  assertEquals(kycRecords[0].status, PayKycStatus.PENDING);
  assertEquals(kycRecords[0].jurisdiction, "JP");
});

// ---------------------------------------------------------------------------
// Updates existing KYC record to PENDING
// ---------------------------------------------------------------------------

Deno.test("kyc post - updates existing KYC record to PENDING", async () => {
  await ensureInitialized();
  await resetDb();

  const address = testAddress();
  // Create an existing NONE record
  await createTestKyc(address, PayKycStatus.NONE);

  const { ctx, getResponse } = createMockContext(
    { address, jurisdiction: "BR" },
    selfCustodialSession(address),
  );

  await postKycHandler(ctx);

  assertEquals(getResponse().status, 200);

  const kycRecords = await getAllKyc();
  const record = kycRecords.find((k) => k.address === address);
  assertEquals(record?.status, PayKycStatus.PENDING);
  assertEquals(record?.jurisdiction, "BR");
  // Should still be only 1 record (updated, not duplicated)
  assertEquals(kycRecords.filter((k) => k.address === address).length, 1);
});

// ---------------------------------------------------------------------------
// Missing address or jurisdiction returns 400
// ---------------------------------------------------------------------------

Deno.test("kyc post - missing address returns 400", async () => {
  await ensureInitialized();
  await resetDb();

  const { ctx, getResponse } = createMockContext(
    { jurisdiction: "US" },
    selfCustodialSession(testAddress()),
  );

  await postKycHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 400);
  assertEquals((res.body as { message: string }).message, "address and jurisdiction are required");
});

Deno.test("kyc post - missing jurisdiction returns 400", async () => {
  await ensureInitialized();
  await resetDb();

  const address = testAddress();
  const { ctx, getResponse } = createMockContext(
    { address },
    selfCustodialSession(address),
  );

  await postKycHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 400);
  assertEquals((res.body as { message: string }).message, "address and jurisdiction are required");
});

Deno.test("kyc post - empty body returns 400", async () => {
  await ensureInitialized();
  await resetDb();

  const { ctx, getResponse } = createMockContext(
    {},
    selfCustodialSession(testAddress()),
  );

  await postKycHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 400);
  assertEquals((res.body as { message: string }).message, "address and jurisdiction are required");
});
