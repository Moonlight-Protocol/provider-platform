import { assertEquals, assertExists, assertNotEquals } from "jsr:@std/assert";
import {
  ensureInitialized,
  resetDb,
  seedBundle,
  testBundleId,
  getBundleRepo,
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

  const reason = JSON.stringify({ phase: "execution", error: { message: "boom" } });
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
