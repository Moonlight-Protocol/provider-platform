import { assertEquals, assertExists, assertNotEquals } from "@std/assert";
import {
  ensureInitialized,
  getBundleRepo,
  resetDb,
  seedBundle,
  testBundleId,
} from "../../test_helpers.ts";
import { BundleStatus } from "@/persistence/drizzle/entity/operations-bundle.entity.ts";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

Deno.test({
  name: "repository suite setup",
  async fn() {
    await ensureInitialized();
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

// Convenience: reset between logical test groups
async function setup() {
  await ensureInitialized();
  await resetDb();
  return getBundleRepo();
}

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

Deno.test("create – new bundle defaults to retryCount=0, lastFailureReason=null", async () => {
  const repo = await setup();
  const id = testBundleId();
  await seedBundle({ id });

  const found = await repo.findById(id);
  assertExists(found);
  assertEquals(found.retryCount, 0);
  assertEquals(found.lastFailureReason, null);
  assertEquals(found.status, BundleStatus.PENDING);
});

// ---------------------------------------------------------------------------
// update retryCount
// ---------------------------------------------------------------------------

Deno.test("update – increments retryCount and persists", async () => {
  const repo = await setup();
  const id = testBundleId();
  await seedBundle({ id, retryCount: 0 });

  await repo.update(id, { retryCount: 1 });

  const found = await repo.findById(id);
  assertExists(found);
  assertEquals(found.retryCount, 1);
});

Deno.test("update – multiple increments accumulate correctly", async () => {
  const repo = await setup();
  const id = testBundleId();
  await seedBundle({ id, retryCount: 0 });

  await repo.update(id, { retryCount: 1 });
  await repo.update(id, { retryCount: 2 });
  await repo.update(id, { retryCount: 3 });

  const found = await repo.findById(id);
  assertExists(found);
  assertEquals(found.retryCount, 3);
});

// ---------------------------------------------------------------------------
// update status to FAILED (dead-letter)
// ---------------------------------------------------------------------------

Deno.test("update – persists FAILED status with lastFailureReason", async () => {
  const repo = await setup();
  const id = testBundleId();
  await seedBundle({ id });

  const reason = JSON.stringify({
    phase: "execution",
    error: { message: "boom" },
  });
  await repo.update(id, {
    status: BundleStatus.FAILED,
    retryCount: 3,
    lastFailureReason: reason,
  });

  const found = await repo.findById(id);
  assertExists(found);
  assertEquals(found.status, BundleStatus.FAILED);
  assertEquals(found.retryCount, 3);
  assertEquals(found.lastFailureReason, reason);
});

// ---------------------------------------------------------------------------
// findByStatus
// ---------------------------------------------------------------------------

Deno.test("findByStatus(FAILED) – returns dead-letter bundles, excludes PENDING", async () => {
  const repo = await setup();
  const failedId = testBundleId();
  const pendingId = testBundleId();
  await seedBundle({ id: failedId, status: BundleStatus.FAILED });
  await seedBundle({ id: pendingId, status: BundleStatus.PENDING });

  const results = await repo.findByStatus(BundleStatus.FAILED);
  const ids = results.map((r) => r.id);
  assertEquals(ids.includes(failedId), true);
  assertEquals(ids.includes(pendingId), false);
});

Deno.test("findByStatus(PENDING) – returns pending bundles, excludes FAILED", async () => {
  const repo = await setup();
  const failedId = testBundleId();
  const pendingId = testBundleId();
  await seedBundle({ id: failedId, status: BundleStatus.FAILED });
  await seedBundle({ id: pendingId, status: BundleStatus.PENDING });

  const results = await repo.findByStatus(BundleStatus.PENDING);
  const ids = results.map((r) => r.id);
  assertEquals(ids.includes(pendingId), true);
  assertEquals(ids.includes(failedId), false);
});

// ---------------------------------------------------------------------------
// findPendingOrProcessing
// ---------------------------------------------------------------------------

Deno.test("findPendingOrProcessing – excludes FAILED and COMPLETED bundles", async () => {
  const repo = await setup();
  const pendingId = testBundleId();
  const processingId = testBundleId();
  const failedId = testBundleId();
  const completedId = testBundleId();

  await seedBundle({ id: pendingId, status: BundleStatus.PENDING });
  await seedBundle({ id: processingId, status: BundleStatus.PROCESSING });
  await seedBundle({ id: failedId, status: BundleStatus.FAILED });
  await seedBundle({ id: completedId, status: BundleStatus.COMPLETED });

  const results = await repo.findPendingOrProcessing();
  const ids = results.map((r) => r.id);

  assertEquals(ids.includes(pendingId), true);
  assertEquals(ids.includes(processingId), true);
  assertEquals(ids.includes(failedId), false);
  assertEquals(ids.includes(completedId), false);
});

Deno.test("findPendingOrProcessing – soft-deleted bundles are excluded", async () => {
  const repo = await setup();
  const id = testBundleId();
  await seedBundle({ id, status: BundleStatus.PENDING });

  // Soft-delete via the base delete method
  await repo.delete(id);

  const results = await repo.findPendingOrProcessing();
  const ids = results.map((r) => r.id);
  assertEquals(ids.includes(id), false);
});

// ---------------------------------------------------------------------------
// lastFailureReason round-trip
// ---------------------------------------------------------------------------

Deno.test("lastFailureReason – JSON structure round-trips through the DB", async () => {
  const repo = await setup();
  const id = testBundleId();
  await seedBundle({ id });

  const payload = {
    occurredAt: new Date().toISOString(),
    phase: "execution",
    error: { name: "Error", message: "network timeout" },
    bundleIds: [id],
  };
  const json = JSON.stringify(payload);

  await repo.update(id, {
    status: BundleStatus.FAILED,
    retryCount: 3,
    lastFailureReason: json,
  });

  const found = await repo.findById(id);
  assertExists(found);
  assertExists(found.lastFailureReason);

  const parsed = JSON.parse(found.lastFailureReason!);
  assertExists(parsed.occurredAt);
  assertEquals(parsed.phase, "execution");
  assertEquals(parsed.error.message, "network timeout");
  assertNotEquals(parsed.bundleIds, undefined);
});

// ---------------------------------------------------------------------------
// expireOlderThan
// ---------------------------------------------------------------------------

Deno.test("expireOlderThan – expires only bundles older than cutoff with matching statuses", async () => {
  const repo = await setup();
  const oldTime = new Date(Date.now() - 120_000);
  const recentTime = new Date(Date.now() - 5_000);

  const oldPending = testBundleId();
  const oldProcessing = testBundleId();
  const recentPending = testBundleId();
  const oldCompleted = testBundleId();

  await seedBundle({
    id: oldPending,
    status: BundleStatus.PENDING,
    createdAt: oldTime,
  });
  await seedBundle({
    id: oldProcessing,
    status: BundleStatus.PROCESSING,
    createdAt: oldTime,
  });
  await seedBundle({
    id: recentPending,
    status: BundleStatus.PENDING,
    createdAt: recentTime,
  });
  await seedBundle({
    id: oldCompleted,
    status: BundleStatus.COMPLETED,
    createdAt: oldTime,
  });

  const cutoff = new Date(Date.now() - 60_000);
  const expired = await repo.expireOlderThan(cutoff, [
    BundleStatus.PENDING,
    BundleStatus.PROCESSING,
  ]);

  assertEquals(expired.length, 2);
  assertEquals(expired.includes(oldPending), true);
  assertEquals(expired.includes(oldProcessing), true);
  assertEquals(expired.includes(recentPending), false);
  assertEquals(expired.includes(oldCompleted), false);

  const found = await repo.findById(oldPending);
  assertExists(found);
  assertEquals(found.status, BundleStatus.EXPIRED);
});

Deno.test("expireOlderThan – with limit restricts number of expired rows", async () => {
  const repo = await setup();
  const oldTime = new Date(Date.now() - 120_000);

  const ids: string[] = [];
  for (let i = 0; i < 5; i++) {
    const id = testBundleId();
    ids.push(id);
    await seedBundle({ id, status: BundleStatus.PENDING, createdAt: oldTime });
  }

  const cutoff = new Date(Date.now() - 60_000);
  const expired = await repo.expireOlderThan(cutoff, [BundleStatus.PENDING], 3);

  assertEquals(expired.length, 3);
  for (const id of expired) {
    assertEquals(ids.includes(id), true);
  }
});

Deno.test("expireOlderThan – returns empty array when nothing matches", async () => {
  const repo = await setup();
  const recentTime = new Date(Date.now() - 5_000);
  await seedBundle({ status: BundleStatus.PENDING, createdAt: recentTime });

  const cutoff = new Date(Date.now() - 60_000);
  const expired = await repo.expireOlderThan(cutoff, [BundleStatus.PENDING]);

  assertEquals(expired.length, 0);
});

// ---------------------------------------------------------------------------
// expireByIds
// ---------------------------------------------------------------------------

Deno.test("expireByIds – expires only active bundles from the given list", async () => {
  const repo = await setup();
  const pendingId = testBundleId();
  const processingId = testBundleId();
  const failedId = testBundleId();

  await seedBundle({ id: pendingId, status: BundleStatus.PENDING });
  await seedBundle({ id: processingId, status: BundleStatus.PROCESSING });
  await seedBundle({ id: failedId, status: BundleStatus.FAILED });

  const expired = await repo.expireByIds(
    [pendingId, processingId, failedId],
    [BundleStatus.PENDING, BundleStatus.PROCESSING],
  );

  assertEquals(expired.length, 2);
  assertEquals(expired.includes(pendingId), true);
  assertEquals(expired.includes(processingId), true);
  assertEquals(expired.includes(failedId), false);
});

Deno.test("expireByIds – returns empty for empty input", async () => {
  await setup();
  const repo = getBundleRepo();
  const expired = await repo.expireByIds([], [BundleStatus.PENDING]);
  assertEquals(expired.length, 0);
});

Deno.test("expireByIds – skips already-expired bundles", async () => {
  const repo = await setup();
  const id = testBundleId();
  await seedBundle({ id, status: BundleStatus.EXPIRED });

  const expired = await repo.expireByIds([id], [
    BundleStatus.PENDING,
    BundleStatus.PROCESSING,
  ]);
  assertEquals(expired.length, 0);
});

// ---------------------------------------------------------------------------
// findByStatusAndDateRange
// ---------------------------------------------------------------------------

Deno.test("findByStatusAndDateRange – filters by date range and status", async () => {
  const repo = await setup();
  const oldTime = new Date(Date.now() - 120_000);
  const recentTime = new Date(Date.now() - 5_000);

  const oldId = testBundleId();
  const recentId = testBundleId();

  await seedBundle({
    id: oldId,
    status: BundleStatus.PENDING,
    createdAt: oldTime,
  });
  await seedBundle({
    id: recentId,
    status: BundleStatus.PENDING,
    createdAt: recentTime,
  });

  const cutoff = new Date(Date.now() - 60_000);
  const results = await repo.findByStatusAndDateRange(
    BundleStatus.PENDING,
    undefined,
    cutoff,
  );
  const ids = results.map((r) => r.id);

  assertEquals(ids.includes(oldId), true);
  assertEquals(ids.includes(recentId), false);
});

Deno.test("findByStatusAndDateRange – respects limit", async () => {
  const repo = await setup();
  for (let i = 0; i < 5; i++) {
    await seedBundle({ status: BundleStatus.PENDING });
  }

  const results = await repo.findByStatusAndDateRange(
    BundleStatus.PENDING,
    undefined,
    undefined,
    3,
  );
  assertEquals(results.length, 3);
});

// ---------------------------------------------------------------------------
// updateStatusIfActive
// ---------------------------------------------------------------------------

Deno.test("updateStatusIfActive – succeeds when status is active", async () => {
  const repo = await setup();
  const id = testBundleId();
  await seedBundle({ id, status: BundleStatus.PENDING });

  const updated = await repo.updateStatusIfActive(
    id,
    BundleStatus.PROCESSING,
    [BundleStatus.PENDING, BundleStatus.PROCESSING],
  );

  assertEquals(updated, true);
  const found = await repo.findById(id);
  assertExists(found);
  assertEquals(found.status, BundleStatus.PROCESSING);
});

Deno.test("updateStatusIfActive – fails when status is terminal (EXPIRED)", async () => {
  const repo = await setup();
  const id = testBundleId();
  await seedBundle({ id, status: BundleStatus.EXPIRED });

  const updated = await repo.updateStatusIfActive(
    id,
    BundleStatus.PROCESSING,
    [BundleStatus.PENDING, BundleStatus.PROCESSING],
  );

  assertEquals(updated, false);
  const found = await repo.findById(id);
  assertExists(found);
  assertEquals(found.status, BundleStatus.EXPIRED);
});

Deno.test("updateStatusIfActive – fails when status is terminal (FAILED)", async () => {
  const repo = await setup();
  const id = testBundleId();
  await seedBundle({ id, status: BundleStatus.FAILED });

  const updated = await repo.updateStatusIfActive(
    id,
    BundleStatus.PROCESSING,
    [BundleStatus.PENDING, BundleStatus.PROCESSING],
  );

  assertEquals(updated, false);
  const found = await repo.findById(id);
  assertExists(found);
  assertEquals(found.status, BundleStatus.FAILED);
});

Deno.test("updateStatusIfActive – fails when status is terminal (COMPLETED)", async () => {
  const repo = await setup();
  const id = testBundleId();
  await seedBundle({ id, status: BundleStatus.COMPLETED });

  const updated = await repo.updateStatusIfActive(
    id,
    BundleStatus.PROCESSING,
    [BundleStatus.PENDING, BundleStatus.PROCESSING],
  );

  assertEquals(updated, false);
  const found = await repo.findById(id);
  assertExists(found);
  assertEquals(found.status, BundleStatus.COMPLETED);
});
