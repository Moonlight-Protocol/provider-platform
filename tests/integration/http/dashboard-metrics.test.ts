import "../../ensure_test_env.ts";
import { Application, Router } from "@oak/oak";
import { assertEquals } from "@std/assert";
import { newNoop } from "@/utils/logger/index.ts";
import {
  handleGetMetrics,
  setMetricsRepoForTests,
} from "@/http/v1/dashboard/metrics.ts";
import { setPpRepoForOwnershipTests } from "@/http/middleware/require-pp-ownership.ts";
import { buildProvidersRouter } from "@/http/v1/providers/routes.ts";
import generateJwt from "@/core/service/auth/generate-jwt.ts";
import { MempoolMetricRepository } from "@/persistence/drizzle/repository/mempool-metric.repository.ts";
import { PpRepository } from "@/persistence/drizzle/repository/pp.repository.ts";
import { paymentProvider } from "@/persistence/drizzle/entity/pp.entity.ts";
import { mempoolMetric } from "@/persistence/drizzle/entity/mempool-metric.entity.ts";
import { ensureInitialized, getTestDb } from "../../test_helpers.ts";

const OWNER_PUBLIC_KEY =
  "GOWNER1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const OTHER_OWNER_PUBLIC_KEY =
  "GOWNER2AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const PP_PUBLIC_KEY =
  "GPP1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const OTHER_PP_PUBLIC_KEY =
  "GPP2AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function buildMetricsUrl(ppPublicKey: string, rangeMin?: number): string {
  const base = `http://localhost/api/v1/providers/${ppPublicKey}/metrics`;
  if (rangeMin === undefined) return base;
  return `${base}?rangeMin=${rangeMin}`;
}

function createTestApp(): Application {
  const log = newNoop();
  const app = new Application();
  const apiRouter = new Router();
  const providersRouter = buildProvidersRouter({ log });
  apiRouter.use(
    "/api/v1",
    providersRouter.routes(),
    providersRouter.allowedMethods(),
  );
  app.use(apiRouter.routes());
  app.use(apiRouter.allowedMethods());
  return app;
}

// Keep the unused-symbol references alive so the symbols stay covered by the
// import (handler is wired via the router; we don't call it directly).
void handleGetMetrics;

async function seedDb(): Promise<void> {
  const db = getTestDb();
  await db.delete(mempoolMetric);
  await db.delete(paymentProvider);

  const now = new Date();
  await db.insert(paymentProvider).values([
    {
      id: "pp-test-1",
      publicKey: PP_PUBLIC_KEY,
      encryptedSk: "encrypted-test-sk",
      derivationIndex: 0,
      ownerPublicKey: OWNER_PUBLIC_KEY,
      isActive: true,
      label: "Test Provider",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "pp-test-2",
      publicKey: OTHER_PP_PUBLIC_KEY,
      encryptedSk: "encrypted-test-sk-2",
      derivationIndex: 1,
      ownerPublicKey: OTHER_OWNER_PUBLIC_KEY,
      isActive: true,
      label: "Other Provider",
      createdAt: now,
      updatedAt: now,
    },
  ]);
}

async function seedSnapshot(
  ppPublicKey: string | null,
  recordedAt: Date,
  values: Partial<
    { queueDepth: number; bundlesCompleted: number; bundlesFailed: number }
  > = {},
): Promise<void> {
  const db = getTestDb();
  await db.insert(mempoolMetric).values({
    recordedAt,
    platformVersion: "test-0.0.0",
    ppPublicKey,
    queueDepth: values.queueDepth ?? 5,
    slotCount: 2,
    bundlesCompleted: values.bundlesCompleted ?? 3,
    bundlesExpired: 1,
    bundlesFailed: values.bundlesFailed ?? 0,
    avgProcessingMs: 200,
    p95ProcessingMs: 500,
    throughputPerMin: 3,
  });
}

async function request(
  app: Application,
  url: string,
  jwt: string,
): Promise<Response> {
  const response = await app.handle(
    new Request(url, {
      method: "GET",
      headers: { authorization: `Bearer ${jwt}` },
    }),
  );
  if (!response) throw new Error("No response from Oak app");
  return response;
}

async function setup() {
  await ensureInitialized();
  await seedDb();
  const db = getTestDb();
  setMetricsRepoForTests(
    new MempoolMetricRepository(db),
    new PpRepository(db),
  );
  setPpRepoForOwnershipTests(new PpRepository(db));
  return createTestApp();
}

Deno.test({
  name: "dashboard-metrics suite setup",
  async fn() {
    await ensureInitialized();
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test("returns 400 when rangeMin is non-positive", async () => {
  const app = await setup();
  const jwt = await generateJwt(OWNER_PUBLIC_KEY, "test-challenge");
  const res = await request(app, buildMetricsUrl(PP_PUBLIC_KEY, -1), jwt);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "rangeMin must be a positive integer");
});

Deno.test("returns 404 when authenticated operator does not own the requested PP", async () => {
  const app = await setup();
  const jwt = await generateJwt(OTHER_OWNER_PUBLIC_KEY, "test-challenge");
  const res = await request(app, buildMetricsUrl(PP_PUBLIC_KEY), jwt);
  assertEquals(res.status, 404);
});

Deno.test("returns recent snapshots scoped to the requested PP", async () => {
  const app = await setup();
  const now = Date.now();
  await seedSnapshot(PP_PUBLIC_KEY, new Date(now - 30_000), {
    queueDepth: 7,
    bundlesCompleted: 4,
  });
  await seedSnapshot(PP_PUBLIC_KEY, new Date(now - 90_000), { queueDepth: 6 });
  await seedSnapshot(OTHER_PP_PUBLIC_KEY, new Date(now - 30_000), {
    queueDepth: 999,
  });
  await seedSnapshot(null, new Date(now - 30_000), { queueDepth: 888 });

  const jwt = await generateJwt(OWNER_PUBLIC_KEY, "test-challenge");
  const res = await request(app, buildMetricsUrl(PP_PUBLIC_KEY, 60), jwt);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.data.ppPublicKey, PP_PUBLIC_KEY);
  assertEquals(body.data.rangeMin, 60);
  assertEquals(body.data.snapshots.length, 2);
  assertEquals(body.data.snapshots[0].queueDepth, 7);
  assertEquals(body.data.snapshots[1].queueDepth, 6);
});

Deno.test("excludes snapshots outside the rangeMin window", async () => {
  const app = await setup();
  const now = Date.now();
  await seedSnapshot(PP_PUBLIC_KEY, new Date(now - 30_000), { queueDepth: 1 });
  await seedSnapshot(
    PP_PUBLIC_KEY,
    new Date(now - 5 * 60_000),
    { queueDepth: 2 },
  );
  await seedSnapshot(
    PP_PUBLIC_KEY,
    new Date(now - 10 * 60_000),
    { queueDepth: 3 },
  );

  const jwt = await generateJwt(OWNER_PUBLIC_KEY, "test-challenge");
  const res = await request(app, buildMetricsUrl(PP_PUBLIC_KEY, 2), jwt);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.data.snapshots.length, 1);
  assertEquals(body.data.snapshots[0].queueDepth, 1);
});

Deno.test("snapshot payload exposes bundlesFailed for the error-rate counter", async () => {
  const app = await setup();
  const now = Date.now();
  await seedSnapshot(PP_PUBLIC_KEY, new Date(now - 30_000), {
    bundlesCompleted: 7,
    bundlesFailed: 2,
  });

  const jwt = await generateJwt(OWNER_PUBLIC_KEY, "test-challenge");
  const res = await request(app, buildMetricsUrl(PP_PUBLIC_KEY, 60), jwt);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.data.snapshots.length, 1);
  assertEquals(body.data.snapshots[0].bundlesFailed, 2);
  assertEquals(body.data.snapshots[0].bundlesCompleted, 7);
});

Deno.test("defaults rangeMin to 60 when omitted", async () => {
  const app = await setup();
  const jwt = await generateJwt(OWNER_PUBLIC_KEY, "test-challenge");
  const res = await request(app, buildMetricsUrl(PP_PUBLIC_KEY), jwt);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.data.rangeMin, 60);
});

Deno.test("returns 401 when JWT is missing", async () => {
  const app = await setup();
  const response = await app.handle(
    new Request(buildMetricsUrl(PP_PUBLIC_KEY), { method: "GET" }),
  );
  if (!response) throw new Error("No response from Oak app");
  assertEquals(response.status, 401);
});

Deno.test("legacy /dashboard/metrics returns 410 Gone", async () => {
  // Wired in the dashboard router; we just confirm the path-shape contract.
  // Full coverage of the dashboard 410-stub surface lives in dashboard-routes
  // — this assertion is here to flag any accidental re-enable.
  const { buildDashboardRouter } = await import(
    "@/http/v1/dashboard/routes.ts"
  );
  const app = new Application();
  const apiRouter = new Router();
  const dashboardRouter = buildDashboardRouter({ log: newNoop() });
  apiRouter.use(
    "/api/v1",
    dashboardRouter.routes(),
    dashboardRouter.allowedMethods(),
  );
  app.use(apiRouter.routes());
  app.use(apiRouter.allowedMethods());

  const res = await app.handle(
    new Request("http://localhost/api/v1/dashboard/metrics", { method: "GET" }),
  );
  if (!res) throw new Error("No response");
  assertEquals(res.status, 410);
});
