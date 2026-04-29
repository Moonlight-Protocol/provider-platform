/**
 * Integration tests for the escrow summary handler.
 *
 * Uses PGlite (in-memory PostgreSQL via WASM) — real SQL, real transactions.
 * Run with: deno test --allow-all --config src/http/v1/pay/tests/deno.json src/http/v1/pay/tests/escrow_summary_test.ts
 */
import { assertEquals } from "@std/assert";
import { getEscrowSummaryHandler } from "@/http/v1/pay/escrow/summary.ts";
import {
  createTestEscrow,
  ensureInitialized,
  PayEscrowStatus,
  resetDb,
  testAddress,
} from "./test_helpers.ts";

// ---------------------------------------------------------------------------
// Mock Oak Context helper
// The escrow summary handler reads ctx.params.address (set by Oak router).
// ---------------------------------------------------------------------------

type MockResponse = { status: number; body: unknown };

function createMockContext(
  params: { address?: string },
  session?: unknown,
): {
  ctx: Parameters<typeof getEscrowSummaryHandler>[0];
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
    state: { session: session ?? {} },
  };

  return {
    // deno-lint-ignore no-explicit-any
    ctx: ctx as any,
    getResponse: () => ({ status: responseStatus, body: responseBody }),
  };
}

// ---------------------------------------------------------------------------
// Returns count and total for held escrows
// ---------------------------------------------------------------------------

Deno.test("escrow summary - returns correct count and total for held escrows", async () => {
  await ensureInitialized();
  await resetDb();

  const receiverAddress = testAddress();
  const senderAddress = testAddress();

  await createTestEscrow({
    heldForAddress: receiverAddress,
    senderAddress,
    amount: 3000n,
    mode: "custodial",
  });
  await createTestEscrow({
    heldForAddress: receiverAddress,
    senderAddress,
    amount: 7000n,
    mode: "self",
  });

  const { ctx, getResponse } = createMockContext(
    { address: receiverAddress },
    { sub: receiverAddress },
  );

  await getEscrowSummaryHandler(ctx);
  const res = getResponse();

  assertEquals(
    res.status,
    200,
    `Expected 200 but got ${res.status}: ${JSON.stringify(res.body)}`,
  );
  assertEquals(
    (res.body as { message: string }).message,
    "Escrow summary retrieved",
  );

  const data =
    (res.body as { data: { count: number; totalAmount: string } }).data;
  assertEquals(data.count, 2);
  assertEquals(data.totalAmount, "10000");
});

// ---------------------------------------------------------------------------
// Returns 0 for address with no escrows
// ---------------------------------------------------------------------------

Deno.test("escrow summary - returns 0 for address with no escrows", async () => {
  await ensureInitialized();
  await resetDb();

  const addr = testAddress();
  const { ctx, getResponse } = createMockContext(
    { address: addr },
    { sub: addr },
  );

  await getEscrowSummaryHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 200);
  const data =
    (res.body as { data: { count: number; totalAmount: string } }).data;
  assertEquals(data.count, 0);
  assertEquals(data.totalAmount, "0");
});

// ---------------------------------------------------------------------------
// Excludes claimed escrows
// ---------------------------------------------------------------------------

Deno.test("escrow summary - excludes claimed escrows from count", async () => {
  await ensureInitialized();
  await resetDb();

  const receiverAddress = testAddress();
  const senderAddress = testAddress();

  await createTestEscrow({
    heldForAddress: receiverAddress,
    senderAddress,
    amount: 5000n,
    mode: "custodial",
    status: PayEscrowStatus.HELD,
  });
  await createTestEscrow({
    heldForAddress: receiverAddress,
    senderAddress,
    amount: 3000n,
    mode: "custodial",
    status: PayEscrowStatus.CLAIMED,
  });

  const { ctx, getResponse } = createMockContext(
    { address: receiverAddress },
    { sub: receiverAddress },
  );

  await getEscrowSummaryHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 200);
  const data =
    (res.body as { data: { count: number; totalAmount: string } }).data;
  assertEquals(data.count, 1, "Only HELD escrows should be counted");
  assertEquals(
    data.totalAmount,
    "5000",
    "Only HELD escrow amount should be summed",
  );
});

// ---------------------------------------------------------------------------
// Missing address returns 400
// ---------------------------------------------------------------------------

Deno.test("escrow summary - missing address returns 400", async () => {
  await ensureInitialized();
  await resetDb();

  const { ctx, getResponse } = createMockContext({});

  await getEscrowSummaryHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 400);
  assertEquals(
    (res.body as { message: string }).message,
    "Address is required",
  );
});

Deno.test("escrow summary - undefined params returns 400", async () => {
  await ensureInitialized();
  await resetDb();

  // Simulate no params at all
  let responseStatus = 200;
  let responseBody: unknown = undefined;

  const ctx = {
    request: {
      body: { json: () => Promise.resolve({}) },
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

  // deno-lint-ignore no-explicit-any
  await getEscrowSummaryHandler(ctx as any);

  assertEquals(responseStatus, 400);
  assertEquals(
    (responseBody as { message: string }).message,
    "Address is required",
  );
});
