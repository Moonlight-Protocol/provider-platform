/**
 * Integration tests for the demo simulate-kyc handler.
 *
 * Uses PGlite (in-memory PostgreSQL via WASM) — real SQL, real transactions.
 * Run with: deno test --allow-all --config src/http/v1/pay/tests/deno.json src/http/v1/pay/tests/demo_simulate_kyc_test.ts
 */
import { assertEquals } from "@std/assert";
import { postSimulateKycHandler } from "@/http/v1/pay/demo/simulate-kyc.ts";
import {
  createTestAccount,
  createTestEscrow,
  createTestKyc,
  ensureInitialized,
  getAccount,
  getAllEscrows,
  getAllKyc,
  getAllTransactions,
  PayCustodialStatus,
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
): {
  ctx: Parameters<typeof postSimulateKycHandler>[0];
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
// Creates VERIFIED KYC record (new address)
// ---------------------------------------------------------------------------

Deno.test("demo simulate-kyc - creates VERIFIED KYC record for new address", async () => {
  await ensureInitialized();
  await resetDb();

  const address = testAddress();

  const { ctx, getResponse } = createMockContext({
    address,
    jurisdiction: "US",
  });

  await postSimulateKycHandler(ctx);
  const res = getResponse();

  assertEquals(
    res.status,
    200,
    `Expected 200 but got ${res.status}: ${JSON.stringify(res.body)}`,
  );
  assertEquals((res.body as { message: string }).message, "KYC simulated");

  const data = (res.body as {
    data: { status: string; escrowClaimed: number; escrowAmount: string };
  }).data;
  assertEquals(data.status, "VERIFIED");
  assertEquals(data.escrowClaimed, 0);
  assertEquals(data.escrowAmount, "0");

  const kycRecords = await getAllKyc();
  const record = kycRecords.find((k) => k.address === address);
  assertEquals(record?.status, PayKycStatus.VERIFIED);
  assertEquals(record?.jurisdiction, "US");
});

// ---------------------------------------------------------------------------
// Updates existing KYC record to VERIFIED
// ---------------------------------------------------------------------------

Deno.test("demo simulate-kyc - updates existing PENDING KYC record to VERIFIED", async () => {
  await ensureInitialized();
  await resetDb();

  const address = testAddress();
  await createTestKyc(address, PayKycStatus.PENDING);

  const { ctx, getResponse } = createMockContext({
    address,
    jurisdiction: "EU",
  });

  await postSimulateKycHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 200);

  const kycRecords = await getAllKyc();
  const record = kycRecords.find((k) => k.address === address);
  assertEquals(record?.status, PayKycStatus.VERIFIED);
  assertEquals(record?.jurisdiction, "EU");
  // Should not create a duplicate
  assertEquals(kycRecords.filter((k) => k.address === address).length, 1);
});

// ---------------------------------------------------------------------------
// Claims held escrow after KYC simulation (custodial)
// ---------------------------------------------------------------------------

Deno.test("demo simulate-kyc - claims held custodial escrow after KYC simulation", async () => {
  await ensureInitialized();
  await resetDb();

  const account = await createTestAccount({
    balance: 0n,
    status: PayCustodialStatus.ACTIVE,
  });

  const senderAddress = testAddress();
  await createTestEscrow({
    heldForAddress: account.depositAddress,
    senderAddress,
    amount: 5000n,
    mode: "custodial",
  });

  const { ctx, getResponse } = createMockContext({
    address: account.depositAddress,
    jurisdiction: "US",
  });

  await postSimulateKycHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 200);
  const data =
    (res.body as { data: { escrowClaimed: number; escrowAmount: string } })
      .data;
  assertEquals(data.escrowClaimed, 1);
  assertEquals(data.escrowAmount, "5000");

  // Escrow should be CLAIMED
  const escrows = await getAllEscrows();
  const claimed = escrows.filter(
    (e) =>
      e.heldForAddress === account.depositAddress &&
      e.status === PayEscrowStatus.CLAIMED,
  );
  assertEquals(claimed.length, 1);

  // Custodial account balance should be credited
  const updatedAccount = await getAccount(account.id);
  assertEquals(updatedAccount?.balance, 5000n);

  // RECEIVE transaction should be created
  const txs = (await getAllTransactions()).filter(
    (t) =>
      t.accountId === account.depositAddress &&
      t.type === PayTransactionType.RECEIVE,
  );
  assertEquals(txs.length, 1);
  assertEquals(txs[0].status, PayTransactionStatus.COMPLETED);
  assertEquals(txs[0].amount, 5000n);
});

// ---------------------------------------------------------------------------
// Claims multiple held escrows
// ---------------------------------------------------------------------------

Deno.test("demo simulate-kyc - claims multiple held escrows", async () => {
  await ensureInitialized();
  await resetDb();

  const account = await createTestAccount({
    balance: 0n,
    status: PayCustodialStatus.ACTIVE,
  });

  const senderAddress = testAddress();
  await createTestEscrow({
    heldForAddress: account.depositAddress,
    senderAddress,
    amount: 3000n,
    mode: "custodial",
  });
  await createTestEscrow({
    heldForAddress: account.depositAddress,
    senderAddress,
    amount: 7000n,
    mode: "custodial",
  });

  const { ctx, getResponse } = createMockContext({
    address: account.depositAddress,
    jurisdiction: "US",
  });

  await postSimulateKycHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 200);
  const data =
    (res.body as { data: { escrowClaimed: number; escrowAmount: string } })
      .data;
  assertEquals(data.escrowClaimed, 2);
  assertEquals(data.escrowAmount, "10000");

  const updatedAccount = await getAccount(account.id);
  assertEquals(updatedAccount?.balance, 10000n);
});

// ---------------------------------------------------------------------------
// Self-custodial escrow claim (no balance credit)
// ---------------------------------------------------------------------------

Deno.test("demo simulate-kyc - self-custodial escrow is claimed but no balance credit", async () => {
  await ensureInitialized();
  await resetDb();

  const selfAddress = testAddress();
  const senderAddress = testAddress();

  await createTestEscrow({
    heldForAddress: selfAddress,
    senderAddress,
    amount: 5000n,
    mode: "self",
  });

  const { ctx, getResponse } = createMockContext({
    address: selfAddress,
    jurisdiction: "US",
  });

  await postSimulateKycHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 200);
  const data =
    (res.body as { data: { escrowClaimed: number; escrowAmount: string } })
      .data;
  assertEquals(data.escrowClaimed, 1);
  assertEquals(data.escrowAmount, "5000");

  // Escrow should be CLAIMED
  const escrows = await getAllEscrows();
  assertEquals(
    escrows.filter((e) => e.status === PayEscrowStatus.CLAIMED).length,
    1,
  );

  // RECEIVE transaction should still be created
  const txs = (await getAllTransactions()).filter(
    (t) => t.accountId === selfAddress && t.type === PayTransactionType.RECEIVE,
  );
  assertEquals(txs.length, 1);
});

// ---------------------------------------------------------------------------
// Missing address or jurisdiction returns 400
// ---------------------------------------------------------------------------

Deno.test("demo simulate-kyc - missing address returns 400", async () => {
  await ensureInitialized();
  await resetDb();

  const { ctx, getResponse } = createMockContext({
    jurisdiction: "US",
  });

  await postSimulateKycHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 400);
  assertEquals(
    (res.body as { message: string }).message,
    "address and jurisdiction are required",
  );
});

Deno.test("demo simulate-kyc - missing jurisdiction returns 400", async () => {
  await ensureInitialized();
  await resetDb();

  const { ctx, getResponse } = createMockContext({
    address: testAddress(),
  });

  await postSimulateKycHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 400);
  assertEquals(
    (res.body as { message: string }).message,
    "address and jurisdiction are required",
  );
});

Deno.test("demo simulate-kyc - empty body returns 400", async () => {
  await ensureInitialized();
  await resetDb();

  const { ctx, getResponse } = createMockContext({});

  await postSimulateKycHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 400);
  assertEquals(
    (res.body as { message: string }).message,
    "address and jurisdiction are required",
  );
});
