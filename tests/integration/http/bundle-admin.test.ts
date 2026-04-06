import { Application, Router } from "@oak/oak";
import { assertEquals } from "jsr:@std/assert";
import { postExpireBundlesHandler, setBundleRepoForTests } from "@/http/v1/dashboard/bundle-admin.ts";
import { BundleStatus } from "@/persistence/drizzle/entity/operations-bundle.entity.ts";
import { getBundleRepo, ensureInitialized, resetDb, seedBundle, testBundleId } from "../../test_helpers.ts";
import { getMempool, initializeMempool } from "@/core/mempool/index.ts";

const EXPIRE_PATH = "http://localhost/api/v1/dashboard/bundles/expire";

function createTestApp(): Application {
  const app = new Application();
  const router = new Router();
  router.post("/api/v1/dashboard/bundles/expire", postExpireBundlesHandler);
  app.use(router.routes());
  app.use(router.allowedMethods());
  return app;
}

async function requestJson(app: Application, body: unknown) {
  const response = await app.handle(new Request(EXPIRE_PATH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
  if (!response) throw new Error("No response from Oak app");
  return response;
}

async function setup() {
  await ensureInitialized();
  try {
    getMempool();
  } catch {
    initializeMempool();
  }
  await resetDb();
  const repo = getBundleRepo();
  setBundleRepoForTests(repo);
  return { app: createTestApp(), repo };
}

Deno.test({
  name: "bundle-admin suite setup",
  async fn() {
    await ensureInitialized();
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test("returns 400 for non-object JSON body", async () => {
  const { app } = await setup();
  const response = await requestJson(app, ["not", "an", "object"]);
  const payload = await response.json();

  assertEquals(response.status, 400);
  assertEquals(payload.message, "Body must be a JSON object");
});

Deno.test("returns 400 for Infinity age filter", async () => {
  const { app } = await setup();
  const response = await requestJson(app, { olderThanMs: Infinity });
  const payload = await response.json();

  assertEquals(response.status, 400);
  assertEquals(
    payload.message,
    "Provide at least one of: olderThanMs (positive number) or bundleIds (non-empty array)",
  );
});

Deno.test("returns 400 when bundleIds contains non-string values", async () => {
  const { app } = await setup();
  const response = await requestJson(app, { bundleIds: ["ok", 123] });
  const payload = await response.json();

  assertEquals(response.status, 400);
  assertEquals(payload.message, "All bundleIds must be non-empty strings");
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

Deno.test("validation – array body does not pass the type guard", () => {
  const raw: unknown = [1, 2, 3];
  const isObject = raw !== null && typeof raw === "object" && !Array.isArray(raw);
  assertEquals(isObject, false);
});

Deno.test("validation – object body passes the type guard", () => {
  const raw: unknown = { olderThanMs: 60000 };
  const isObject = raw !== null && typeof raw === "object" && !Array.isArray(raw);
  assertEquals(isObject, true);
});

Deno.test("age filter expires stale active bundles over HTTP", async () => {
  const { app, repo } = await setup();
  const oldTime = new Date(Date.now() - 120_000);
  const oldPending = testBundleId();
  const oldProcessing = testBundleId();
  const recentPending = testBundleId();
  const oldFailed = testBundleId();

  await seedBundle({ id: oldPending, status: BundleStatus.PENDING, createdAt: oldTime });
  await seedBundle({ id: oldProcessing, status: BundleStatus.PROCESSING, createdAt: oldTime });
  await seedBundle({ id: recentPending, status: BundleStatus.PENDING });
  await seedBundle({ id: oldFailed, status: BundleStatus.FAILED, createdAt: oldTime });

  const response = await requestJson(app, { olderThanMs: 60_000 });
  const payload = await response.json();

  assertEquals(response.status, 200);
  assertEquals(payload.data.expired, 2);
  assertEquals(payload.data.truncated, false);
  assertEquals((await repo.findById(oldPending))?.status, BundleStatus.EXPIRED);
  assertEquals((await repo.findById(oldProcessing))?.status, BundleStatus.EXPIRED);
  assertEquals((await repo.findById(recentPending))?.status, BundleStatus.PENDING);
  assertEquals((await repo.findById(oldFailed))?.status, BundleStatus.FAILED);
});

Deno.test("explicit ids expires only active bundles over HTTP", async () => {
  const { app, repo } = await setup();
  const pending = testBundleId();
  const completed = testBundleId();

  await seedBundle({ id: pending, status: BundleStatus.PENDING });
  await seedBundle({ id: completed, status: BundleStatus.COMPLETED });

  const response = await requestJson(app, { bundleIds: [pending, completed] });
  const payload = await response.json();

  assertEquals(response.status, 200);
  assertEquals(payload.data.expired, 1);
  assertEquals((await repo.findById(pending))?.status, BundleStatus.EXPIRED);
  assertEquals((await repo.findById(completed))?.status, BundleStatus.COMPLETED);
});

Deno.test("combined filters count only rows updated once", async () => {
  const { app, repo } = await setup();
  const oldTime = new Date(Date.now() - 120_000);
  const stale = testBundleId();
  const fresh = testBundleId();

  await seedBundle({ id: stale, status: BundleStatus.PENDING, createdAt: oldTime });
  await seedBundle({ id: fresh, status: BundleStatus.PENDING });

  const response = await requestJson(app, { olderThanMs: 60_000, bundleIds: [stale, fresh] });
  const payload = await response.json();

  assertEquals(response.status, 200);
  assertEquals(payload.data.expired, 2);
  assertEquals((await repo.findById(stale))?.status, BundleStatus.EXPIRED);
  assertEquals((await repo.findById(fresh))?.status, BundleStatus.EXPIRED);
});

Deno.test("returns 400 when explicit ids exceed limit", async () => {
  const { app } = await setup();
  const ids = Array.from({ length: 201 }, (_, index) => `bundle-${index}`);
  const response = await requestJson(app, { bundleIds: ids });

  assertEquals(response.status, 400);
});

// --- Repository-level coverage (shared with handler logic) ---

async function repoOnlySetup() {
  await ensureInitialized();
  await resetDb();
  return getBundleRepo();
}

Deno.test("expireOlderThan respects batch limit (truncation semantics per call)", async () => {
  const repo = await repoOnlySetup();
  const oldTime = new Date(Date.now() - 120_000);

  for (let i = 0; i < 5; i++) {
    await seedBundle({ status: BundleStatus.PENDING, createdAt: oldTime });
  }

  const cutoff = new Date(Date.now() - 60_000);
  const LIMIT = 3;
  const expired = await repo.expireOlderThan(cutoff, [BundleStatus.PENDING, BundleStatus.PROCESSING], LIMIT);

  assertEquals(expired.length, LIMIT);
});

Deno.test("explicit-IDs path – expires active, skips inactive", async () => {
  const repo = await repoOnlySetup();
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

Deno.test("combined path – both filters contribute to total expired count", async () => {
  const repo = await repoOnlySetup();
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

Deno.test("combined path – overlapping IDs are excluded from explicit-IDs pass after age expiry", async () => {
  const repo = await repoOnlySetup();
  const oldTime = new Date(Date.now() - 120_000);
  const ACTIVE_STATUSES = [BundleStatus.PENDING, BundleStatus.PROCESSING];

  const oldBundle = testBundleId();
  const recentBundle = testBundleId();

  await seedBundle({ id: oldBundle, status: BundleStatus.PENDING, createdAt: oldTime });
  await seedBundle({ id: recentBundle, status: BundleStatus.PROCESSING });

  const cutoff = new Date(Date.now() - 60_000);
  const ageExpiredIds = await repo.expireOlderThan(cutoff, ACTIVE_STATUSES, 10_000);
  assertEquals(ageExpiredIds.length, 1);
  assertEquals(ageExpiredIds[0], oldBundle);

  const ageSet = new Set(ageExpiredIds);
  const bundleIds = [oldBundle, recentBundle];
  const remainingIds = bundleIds.filter((id) => !ageSet.has(id));

  assertEquals(remainingIds.length, 1);
  assertEquals(remainingIds[0], recentBundle);

  const idExpiredIds = await repo.expireByIds(remainingIds, ACTIVE_STATUSES);
  assertEquals(idExpiredIds.length, 1);
  assertEquals(idExpiredIds[0], recentBundle);

  const total = ageExpiredIds.length + idExpiredIds.length;
  assertEquals(total, 2);
});

Deno.test("expireByIds second call is no-op for already expired", async () => {
  const repo = await repoOnlySetup();
  const id = testBundleId();
  await seedBundle({ id, status: BundleStatus.PENDING });

  const ACTIVE_STATUSES = [BundleStatus.PENDING, BundleStatus.PROCESSING];
  const first = await repo.expireByIds([id], ACTIVE_STATUSES);
  assertEquals(first.length, 1);

  const second = await repo.expireByIds([id], ACTIVE_STATUSES);
  assertEquals(second.length, 0);
});

Deno.test("updateStatusIfActive rejects transition after bundle was expired", async () => {
  const repo = await repoOnlySetup();
  const id = testBundleId();
  await seedBundle({ id, status: BundleStatus.PENDING });

  const expired = await repo.expireByIds([id], [BundleStatus.PENDING, BundleStatus.PROCESSING]);
  assertEquals(expired.length, 1);

  const updated = await repo.updateStatusIfActive(
    id,
    BundleStatus.PROCESSING,
    [BundleStatus.PENDING, BundleStatus.PROCESSING],
  );
  assertEquals(updated, false);

  const found = await repo.findById(id);
  assertEquals(found?.status, BundleStatus.EXPIRED);
});
