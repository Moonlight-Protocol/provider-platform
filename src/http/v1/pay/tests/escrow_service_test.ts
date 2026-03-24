/**
 * Integration tests for the escrow service.
 *
 * Uses PGlite (in-memory PostgreSQL via WASM) — real SQL, real transactions.
 * Run with: deno test --allow-all --config src/http/v1/pay/tests/deno.json src/http/v1/pay/tests/escrow_service_test.ts
 */
import { assertEquals, assertExists, assert } from "jsr:@std/assert";
import {
  createEscrow,
  claimEscrowForAddress,
  getEscrowSummary,
} from "@/core/service/pay/escrow.service.ts";
import {
  createTestAccount,
  createTestKyc,
  createTestEscrow,
  testAddress,
  resetDb,
  closeDb,
  ensureInitialized,
  getAccount,
  getAllTransactions,
  getAllEscrows,
  PayEscrowStatus,
  PayTransactionType,
  PayTransactionStatus,
  PayKycStatus,
  PayCustodialStatus,
} from "./test_helpers.ts";

// ---------------------------------------------------------------------------
// createEscrow
// ---------------------------------------------------------------------------

Deno.test("createEscrow - creates a HELD record in the database", async () => {
  await ensureInitialized();
  await resetDb();

  const senderAddress = testAddress();
  const receiverAddress = testAddress();

  const escrowId = await createEscrow({
    senderAddress,
    receiverAddress,
    amount: 5000n,
    mode: "custodial",
  });

  assertExists(escrowId, "createEscrow should return an ID");

  const escrows = (await getAllEscrows()).filter((e) => e.id === escrowId);
  assertEquals(escrows.length, 1);

  const record = escrows[0];
  assertEquals(record.status, PayEscrowStatus.HELD);
  assertEquals(record.heldForAddress, receiverAddress);
  assertEquals(record.senderAddress, senderAddress);
  assertEquals(record.amount, 5000n);
  assertEquals(record.mode, "custodial");
});

// ---------------------------------------------------------------------------
// claimEscrowForAddress
// ---------------------------------------------------------------------------

Deno.test("claimEscrowForAddress - claims held escrows for custodial account", async () => {
  await ensureInitialized();
  await resetDb();

  const account = await createTestAccount({
    balance: 0n,
    status: PayCustodialStatus.ACTIVE,
  });

  await createTestKyc(account.depositAddress, PayKycStatus.VERIFIED);

  const escrowId = await createTestEscrow({
    heldForAddress: account.depositAddress,
    senderAddress: testAddress(),
    amount: 1000n,
    mode: "custodial",
  });

  const result = await claimEscrowForAddress(account.depositAddress);

  assertEquals(result.claimed, 1);
  assertEquals(result.totalAmount, 1000n);

  const updatedEscrow = (await getAllEscrows()).find((e) => e.id === escrowId);
  assertEquals(updatedEscrow?.status, PayEscrowStatus.CLAIMED);

  const updatedAccount = await getAccount(account.id);
  assertEquals(updatedAccount?.balance, 1000n);

  const txs = (await getAllTransactions()).filter((t) => t.accountId === account.depositAddress);
  assertEquals(txs.length, 1);
  assertEquals(txs[0].type, PayTransactionType.RECEIVE);
  assertEquals(txs[0].status, PayTransactionStatus.COMPLETED);
  assertEquals(txs[0].amount, 1000n);
});

Deno.test("claimEscrowForAddress - returns 0 when no held escrows exist", async () => {
  await ensureInitialized();
  await resetDb();

  const address = testAddress();
  await createTestKyc(address, PayKycStatus.VERIFIED);

  const result = await claimEscrowForAddress(address);
  assertEquals(result.claimed, 0);
  assertEquals(result.totalAmount, 0n);
});

Deno.test("claimEscrowForAddress - concurrent claims don't double-credit (race condition)", async () => {
  await ensureInitialized();
  await resetDb();

  const account = await createTestAccount({
    balance: 0n,
    status: PayCustodialStatus.ACTIVE,
  });

  await createTestKyc(account.depositAddress, PayKycStatus.VERIFIED);

  await createTestEscrow({
    heldForAddress: account.depositAddress,
    senderAddress: testAddress(),
    amount: 1000n,
    mode: "custodial",
  });

  const results = await Promise.allSettled([
    claimEscrowForAddress(account.depositAddress),
    claimEscrowForAddress(account.depositAddress),
  ]);

  const fulfilled = results.filter(
    (r) => r.status === "fulfilled",
  ) as PromiseFulfilledResult<{ claimed: number; totalAmount: bigint }>[];

  assert(fulfilled.length >= 1, "At least one claim should succeed");

  const totalClaimed = fulfilled.reduce((sum, r) => sum + r.value.claimed, 0);
  const totalAmount = fulfilled.reduce((sum, r) => sum + r.value.totalAmount, 0n);

  assertEquals(totalClaimed, 1, "Exactly one escrow should be claimed total");
  assertEquals(totalAmount, 1000n, "Total amount should be exactly 1000n");

  const finalAccount = await getAccount(account.id);
  assertEquals(finalAccount?.balance, 1000n, "Balance must be exactly 1000n, not double-credited");

  const txs = (await getAllTransactions()).filter((t) => t.accountId === account.depositAddress);
  assertEquals(txs.length, 1, "Exactly one RECEIVE transaction should exist");
});

// ---------------------------------------------------------------------------
// getEscrowSummary
// ---------------------------------------------------------------------------

Deno.test("getEscrowSummary - returns correct count and total for held escrows", async () => {
  await ensureInitialized();
  await resetDb();

  const receiverAddress = testAddress();
  const senderAddress = testAddress();

  await createTestEscrow({ heldForAddress: receiverAddress, senderAddress, amount: 3000n, mode: "custodial" });
  await createTestEscrow({ heldForAddress: receiverAddress, senderAddress, amount: 7000n, mode: "custodial" });

  const summary = await getEscrowSummary(receiverAddress);
  assertEquals(summary.count, 2);
  assertEquals(summary.totalAmount, 10000n);
});

Deno.test("getEscrowSummary - returns 0 for address with no escrows", async () => {
  await ensureInitialized();
  await resetDb();
  const summary = await getEscrowSummary(testAddress());
  assertEquals(summary.count, 0);
  assertEquals(summary.totalAmount, 0n);
});

Deno.test("getEscrowSummary - excludes claimed escrows", async () => {
  await ensureInitialized();
  await resetDb();

  const receiverAddress = testAddress();
  const senderAddress = testAddress();

  await createTestEscrow({ heldForAddress: receiverAddress, senderAddress, amount: 5000n, mode: "custodial", status: PayEscrowStatus.HELD });
  await createTestEscrow({ heldForAddress: receiverAddress, senderAddress, amount: 3000n, mode: "custodial", status: PayEscrowStatus.CLAIMED });

  const summary = await getEscrowSummary(receiverAddress);
  assertEquals(summary.count, 1, "Only HELD escrows should be counted");
  assertEquals(summary.totalAmount, 5000n, "Only HELD escrow amount should be summed");
});
