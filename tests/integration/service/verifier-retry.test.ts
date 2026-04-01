import { assertEquals, assertExists } from "jsr:@std/assert";
import {
  ensureInitialized,
  resetDb,
  seedBundle,
  seedTransaction,
  testBundleId,
  getBundleRepo,
  getTestDb,
} from "../../test_helpers.ts";
import { handleVerificationFailure } from "@/core/service/verifier/verifier-failure.helpers.ts";
import { BundleStatus } from "@/persistence/drizzle/entity/operations-bundle.entity.ts";
import { TransactionStatus } from "@/persistence/drizzle/entity/transaction.entity.ts";
import type { SlotBundle } from "@/core/service/bundle/bundle.types.ts";
import type { OperationsBundle } from "@/persistence/drizzle/entity/operations-bundle.entity.ts";
import { eq } from "drizzle-orm";
import { transaction } from "@/persistence/drizzle/entity/index.ts";

const MAX_RETRY = 3;

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

async function setup() {
  await ensureInitialized();
  await resetDb();
  return getBundleRepo();
}

/** Minimal updateTxStatus backed by PGlite */
async function updateTxStatus(txId: string, status: TransactionStatus): Promise<void> {
  const db = getTestDb();
  await db.update(transaction).set({ status, updatedAt: new Date() }).where(
    eq(transaction.id, txId),
  );
}

/** Reads the transaction status from PGlite */
async function getTxStatus(txId: string): Promise<TransactionStatus | undefined> {
  const db = getTestDb();
  const [row] = await db
    .select({ status: transaction.status })
    .from(transaction)
    .where(eq(transaction.id, txId));
  return row?.status as TransactionStatus | undefined;
}

/**
 * Mock for `createSlotBundleFromEntity` – avoids WASM/MLXDR parsing entirely.
 * Returns a minimal SlotBundle stub.
 */
function mockCreateSlotBundle(bundle: OperationsBundle): Promise<SlotBundle> {
  return Promise.resolve({
    bundleId: bundle.id,
    operationsMLXDR: bundle.operationsMLXDR,
    operations: { create: [], spend: [], deposit: [], withdraw: [] },
    fee: bundle.fee,
    weight: 1,
    ttl: bundle.ttl,
    createdAt: bundle.createdAt,
    priorityScore: 1,
    retryCount: bundle.retryCount ?? 0,
    lastFailureReason: bundle.lastFailureReason ?? null,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test(
  "verifier – success: bundle→COMPLETED, transaction→VERIFIED (not a failure test; just ensures resetDb works)",
  async () => {
    const repo = await setup();
    const bundleId = testBundleId();
    await seedBundle({ id: bundleId, status: BundleStatus.PROCESSING });
    const tx = await seedTransaction({ bundleIds: [bundleId] });

    // Simulate handleVerificationSuccess inline (not the function under test)
    await repo.update(bundleId, { status: BundleStatus.COMPLETED });
    await updateTxStatus(tx.id, TransactionStatus.VERIFIED);

    const found = await repo.findById(bundleId);
    assertExists(found);
    assertEquals(found.status, BundleStatus.COMPLETED);
    assertEquals(await getTxStatus(tx.id), TransactionStatus.VERIFIED);
  },
);

Deno.test(
  "verifier – failure, below max: status→PENDING, retryCount incremented, reAddBundles called",
  async () => {
    const repo = await setup();
    const bundleId = testBundleId();
    await seedBundle({ id: bundleId, retryCount: 0, status: BundleStatus.PROCESSING });
    const tx = await seedTransaction({ bundleIds: [bundleId] });

    const reAddedBundles: SlotBundle[] = [];

    await handleVerificationFailure(tx.id, "ledger entry not found", [bundleId], {
      operationsBundleRepository: repo,
      updateTxStatus,
      createSlotBundleFn: mockCreateSlotBundle,
      reAddBundlesFn: async (bundles) => {
        reAddedBundles.push(...bundles);
      },
      maxRetryAttempts: MAX_RETRY,
    });

    // Transaction marked FAILED
    assertEquals(await getTxStatus(tx.id), TransactionStatus.FAILED);

    // Bundle moved to PENDING for retry
    const found = await repo.findById(bundleId);
    assertExists(found);
    assertEquals(found.status, BundleStatus.PENDING);
    assertEquals(found.retryCount, 1);
    assertExists(found.lastFailureReason);

    // reAddBundles was called with the bundle
    assertEquals(reAddedBundles.length, 1);
    assertEquals(reAddedBundles[0].bundleId, bundleId);
  },
);

Deno.test(
  "verifier – failure, at max (dead-letter): status→FAILED, retryCount=MAX, reAddBundles NOT called",
  async () => {
    const repo = await setup();
    const bundleId = testBundleId();
    await seedBundle({ id: bundleId, retryCount: 2, status: BundleStatus.PROCESSING });
    const tx = await seedTransaction({ bundleIds: [bundleId] });

    const reAddedBundles: SlotBundle[] = [];

    await handleVerificationFailure(tx.id, "tx timeout", [bundleId], {
      operationsBundleRepository: repo,
      updateTxStatus,
      createSlotBundleFn: mockCreateSlotBundle,
      reAddBundlesFn: async (bundles) => {
        reAddedBundles.push(...bundles);
      },
      maxRetryAttempts: MAX_RETRY,
    });

    // Transaction marked FAILED
    assertEquals(await getTxStatus(tx.id), TransactionStatus.FAILED);

    // Bundle dead-lettered
    const found = await repo.findById(bundleId);
    assertExists(found);
    assertEquals(found.status, BundleStatus.FAILED);
    assertEquals(found.retryCount, 3);

    // reAddBundles was NOT called
    assertEquals(reAddedBundles.length, 0);
  },
);

Deno.test(
  "verifier – mixed bundles: only eligible bundle re-queued",
  async () => {
    const repo = await setup();
    const eligibleId = testBundleId();
    const deadLetterId = testBundleId();

    await seedBundle({ id: eligibleId, retryCount: 0, status: BundleStatus.PROCESSING });
    await seedBundle({ id: deadLetterId, retryCount: 2, status: BundleStatus.PROCESSING });
    const tx = await seedTransaction({ bundleIds: [eligibleId, deadLetterId] });

    const reAddedBundles: SlotBundle[] = [];

    await handleVerificationFailure(
      tx.id,
      "network error",
      [eligibleId, deadLetterId],
      {
        operationsBundleRepository: repo,
        updateTxStatus,
        createSlotBundleFn: mockCreateSlotBundle,
        reAddBundlesFn: async (bundles) => {
          reAddedBundles.push(...bundles);
        },
        maxRetryAttempts: MAX_RETRY,
      },
    );

    const eligible = await repo.findById(eligibleId);
    const deadLetter = await repo.findById(deadLetterId);

    assertExists(eligible);
    assertExists(deadLetter);
    assertEquals(eligible.status, BundleStatus.PENDING);
    assertEquals(deadLetter.status, BundleStatus.FAILED);

    // Only the eligible bundle is re-queued
    assertEquals(reAddedBundles.length, 1);
    assertEquals(reAddedBundles[0].bundleId, eligibleId);
  },
);

Deno.test(
  "verifier – lastFailureReason contains phase='verification' and txId",
  async () => {
    const repo = await setup();
    const bundleId = testBundleId();
    await seedBundle({ id: bundleId, retryCount: 0, status: BundleStatus.PROCESSING });
    const tx = await seedTransaction({ bundleIds: [bundleId] });

    await handleVerificationFailure(tx.id, "bad signature", [bundleId], {
      operationsBundleRepository: repo,
      updateTxStatus,
      createSlotBundleFn: mockCreateSlotBundle,
      reAddBundlesFn: async () => {},
      maxRetryAttempts: MAX_RETRY,
    });

    const found = await repo.findById(bundleId);
    assertExists(found);
    assertExists(found.lastFailureReason);

    const parsed = JSON.parse(found.lastFailureReason!);
    assertEquals(parsed.phase, "verification");
    assertEquals(parsed.txId, tx.id);
    assertExists(parsed.occurredAt);
    assertExists(parsed.error?.message);
    assertEquals(parsed.error.message, "bad signature");
  },
);

Deno.test(
  "verifier – all bundles dead-lettered: reAddBundles not called at all",
  async () => {
    const repo = await setup();
    const id1 = testBundleId();
    const id2 = testBundleId();
    // Both at max retries
    await seedBundle({ id: id1, retryCount: 2, status: BundleStatus.PROCESSING });
    await seedBundle({ id: id2, retryCount: 2, status: BundleStatus.PROCESSING });
    const tx = await seedTransaction({ bundleIds: [id1, id2] });

    let reAddCalled = false;

    await handleVerificationFailure(tx.id, "timeout", [id1, id2], {
      operationsBundleRepository: repo,
      updateTxStatus,
      createSlotBundleFn: mockCreateSlotBundle,
      reAddBundlesFn: async () => {
        reAddCalled = true;
      },
      maxRetryAttempts: MAX_RETRY,
    });

    assertEquals(reAddCalled, false);
    assertEquals((await repo.findById(id1))?.status, BundleStatus.FAILED);
    assertEquals((await repo.findById(id2))?.status, BundleStatus.FAILED);
  },
);
