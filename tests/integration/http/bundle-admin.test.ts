import { assertEquals } from "jsr:@std/assert";
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
  name: "bundle-admin suite setup",
  async fn() {
    await ensureInitialized();
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

async function setup() {
  await ensureInitialized();
  await resetDb();
  return getBundleRepo();
}

// ---------------------------------------------------------------------------
// Validation: hasAgeFilter guard
// ---------------------------------------------------------------------------

Deno.test("validation – Infinity does not pass the age-filter guard", () => {
  const olderThanMs: number = Infinity;
  const hasAgeFilter = typeof olderThanMs === "number" && Number.isFinite(olderThanMs) && olderThanMs > 0;
  assertEquals(hasAgeFilter, false);
});

Deno.test("validation – NaN does not pass the age-filter guard", () => {
  const olderThanMs: number = NaN;
  const hasAgeFilter = typeof olderThanMs === "number" && Number.isFinite(olderThanMs) && olderThanMs > 0;
  assertEquals(hasAgeFilter, false);
});

Deno.test("validation – negative number does not pass the age-filter guard", () => {
  const olderThanMs: number = -1000;
  const hasAgeFilter = typeof olderThanMs === "number" && Number.isFinite(olderThanMs) && olderThanMs > 0;
  assertEquals(hasAgeFilter, false);
});

Deno.test("validation – zero does not pass the age-filter guard", () => {
  const olderThanMs: number = 0;
  const hasAgeFilter = typeof olderThanMs === "number" && Number.isFinite(olderThanMs) && olderThanMs > 0;
  assertEquals(hasAgeFilter, false);
});

Deno.test("validation – positive finite number passes the age-filter guard", () => {
  const olderThanMs: number = 60_000;
  const hasAgeFilter = typeof olderThanMs === "number" && Number.isFinite(olderThanMs) && olderThanMs > 0;
  assertEquals(hasAgeFilter, true);
});

// ---------------------------------------------------------------------------
// Validation: bundleIds element types
// ---------------------------------------------------------------------------

Deno.test("validation – non-string elements in bundleIds are rejected", () => {
  // deno-lint-ignore no-explicit-any
  const bundleIds: any[] = [123, null, {}];
  const allStrings = bundleIds.every((id) => typeof id === "string" && id.length > 0);
  assertEquals(allStrings, false);
});

Deno.test("validation – empty string in bundleIds is rejected", () => {
  const bundleIds = ["valid-id", ""];
  const allStrings = bundleIds.every((id) => typeof id === "string" && id.length > 0);
  assertEquals(allStrings, false);
});

Deno.test("validation – valid string bundleIds pass", () => {
  const bundleIds = ["id-1", "id-2", "id-3"];
  const allStrings = bundleIds.every((id) => typeof id === "string" && id.length > 0);
  assertEquals(allStrings, true);
});

// ---------------------------------------------------------------------------
// Age-filter path: expireOlderThan (mirrors handler line 68-80)
// ---------------------------------------------------------------------------

Deno.test("age-filter path – expires old PENDING/PROCESSING bundles, returns IDs", async () => {
  const repo = await setup();
  const oldTime = new Date(Date.now() - 120_000);

  const oldPending = testBundleId();
  const oldProcessing = testBundleId();
  const recentPending = testBundleId();
  const oldFailed = testBundleId();

  await seedBundle({ id: oldPending, status: BundleStatus.PENDING, createdAt: oldTime });
  await seedBundle({ id: oldProcessing, status: BundleStatus.PROCESSING, createdAt: oldTime });
  await seedBundle({ id: recentPending, status: BundleStatus.PENDING, createdAt: new Date() });
  await seedBundle({ id: oldFailed, status: BundleStatus.FAILED, createdAt: oldTime });

  const cutoff = new Date(Date.now() - 60_000);
  const ACTIVE_STATUSES = [BundleStatus.PENDING, BundleStatus.PROCESSING];
  const AGE_FILTER_LIMIT = 10_000;

  const ageExpiredIds = await repo.expireOlderThan(cutoff, ACTIVE_STATUSES, AGE_FILTER_LIMIT);

  assertEquals(ageExpiredIds.length, 2);
  assertEquals(ageExpiredIds.includes(oldPending), true);
  assertEquals(ageExpiredIds.includes(oldProcessing), true);

  const pendingFound = await repo.findById(oldPending);
  assertEquals(pendingFound?.status, BundleStatus.EXPIRED);

  const recentFound = await repo.findById(recentPending);
  assertEquals(recentFound?.status, BundleStatus.PENDING);

  const failedFound = await repo.findById(oldFailed);
  assertEquals(failedFound?.status, BundleStatus.FAILED);
});

Deno.test("age-filter path – truncation flag when limit is hit", async () => {
  const repo = await setup();
  const oldTime = new Date(Date.now() - 120_000);

  for (let i = 0; i < 5; i++) {
    await seedBundle({ status: BundleStatus.PENDING, createdAt: oldTime });
  }

  const cutoff = new Date(Date.now() - 60_000);
  const LIMIT = 3;
  const expired = await repo.expireOlderThan(cutoff, [BundleStatus.PENDING, BundleStatus.PROCESSING], LIMIT);

  assertEquals(expired.length, LIMIT);
  const truncated = expired.length >= LIMIT;
  assertEquals(truncated, true);
});

// ---------------------------------------------------------------------------
// Explicit-IDs path: expireByIds (mirrors handler line 82-103)
// ---------------------------------------------------------------------------

Deno.test("explicit-IDs path – expires active, skips inactive", async () => {
  const repo = await setup();
  const pendingId = testBundleId();
  const expiredId = testBundleId();
  const completedId = testBundleId();

  await seedBundle({ id: pendingId, status: BundleStatus.PENDING });
  await seedBundle({ id: expiredId, status: BundleStatus.EXPIRED });
  await seedBundle({ id: completedId, status: BundleStatus.COMPLETED });

  const ACTIVE_STATUSES = [BundleStatus.PENDING, BundleStatus.PROCESSING];
  const ids = [pendingId, expiredId, completedId];
  const result = await repo.expireByIds(ids, ACTIVE_STATUSES);

  assertEquals(result.length, 1);
  assertEquals(result[0], pendingId);

  const skipped = ids.length - result.length;
  assertEquals(skipped, 2);
});

// ---------------------------------------------------------------------------
// Combined age + IDs path
// ---------------------------------------------------------------------------

Deno.test("combined path – both filters contribute to total expired count", async () => {
  const repo = await setup();
  const oldTime = new Date(Date.now() - 120_000);
  const ACTIVE_STATUSES = [BundleStatus.PENDING, BundleStatus.PROCESSING];

  const oldBundle = testBundleId();
  const recentBundle = testBundleId();

  await seedBundle({ id: oldBundle, status: BundleStatus.PENDING, createdAt: oldTime });
  await seedBundle({ id: recentBundle, status: BundleStatus.PROCESSING });

  const cutoff = new Date(Date.now() - 60_000);
  const ageExpiredIds = await repo.expireOlderThan(cutoff, ACTIVE_STATUSES, 10_000);
  const idExpiredIds = await repo.expireByIds([recentBundle], ACTIVE_STATUSES);

  assertEquals(ageExpiredIds.length, 1);
  assertEquals(ageExpiredIds[0], oldBundle);
  assertEquals(idExpiredIds.length, 1);
  assertEquals(idExpiredIds[0], recentBundle);

  const total = ageExpiredIds.length + idExpiredIds.length;
  assertEquals(total, 2);
});

// ---------------------------------------------------------------------------
// Already-expired bundles are not double-counted
// ---------------------------------------------------------------------------

Deno.test("already-expired – double expiry is a no-op", async () => {
  const repo = await setup();
  const id = testBundleId();
  await seedBundle({ id, status: BundleStatus.PENDING });

  const ACTIVE_STATUSES = [BundleStatus.PENDING, BundleStatus.PROCESSING];
  const first = await repo.expireByIds([id], ACTIVE_STATUSES);
  assertEquals(first.length, 1);

  const second = await repo.expireByIds([id], ACTIVE_STATUSES);
  assertEquals(second.length, 0);
});

// ---------------------------------------------------------------------------
// Race condition: updateStatusIfActive prevents resurrection
// ---------------------------------------------------------------------------

Deno.test("race condition – updateStatusIfActive rejects EXPIRED bundle", async () => {
  const repo = await setup();
  const id = testBundleId();
  await seedBundle({ id, status: BundleStatus.PENDING });

  // Admin expire sets status to EXPIRED
  const expired = await repo.expireByIds([id], [BundleStatus.PENDING, BundleStatus.PROCESSING]);
  assertEquals(expired.length, 1);

  // Executor's addBundle tries to set back to PROCESSING — should fail
  const updated = await repo.updateStatusIfActive(
    id,
    BundleStatus.PROCESSING,
    [BundleStatus.PENDING, BundleStatus.PROCESSING],
  );
  assertEquals(updated, false);

  // Status stays EXPIRED
  const found = await repo.findById(id);
  assertEquals(found?.status, BundleStatus.EXPIRED);
});
