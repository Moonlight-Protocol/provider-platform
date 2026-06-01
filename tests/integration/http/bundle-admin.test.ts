import "../../ensure_test_env.ts";
import { Application, Router } from "@oak/oak";
import { assertEquals } from "@std/assert";
import { newNoop } from "@/utils/logger/index.ts";
import { buildDashboardRouter } from "@/http/v1/dashboard/routes.ts";
import { ensureInitialized, resetDb } from "../../test_helpers.ts";

/**
 * After the URL-scoping migration:
 *   - POST /dashboard/bundles/expire was bare-deleted (no admin/operator
 *     callers; the in-house admin tool will hit an internal-only path or be
 *     re-introduced under /providers/:pp/... if needed). This file now only
 *     asserts that the dashboard router does NOT route the path.
 *   - GET  /dashboard/bundles (query variant) was bare-deleted too.
 *
 * The repository-level coverage for expireOlderThan / expireByIds /
 * updateStatusIfActive still lives in the repository's own unit tests.
 */

const EXPIRE_PATH = "http://localhost/api/v1/dashboard/bundles/expire";
const LIST_PATH = "http://localhost/api/v1/dashboard/bundles";

function createTestApp(): Application {
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
  return app;
}

async function setup() {
  await ensureInitialized();
  await resetDb();
  return createTestApp();
}

Deno.test({
  name: "bundle-admin suite setup",
  async fn() {
    await ensureInitialized();
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test("POST /dashboard/bundles/expire is not routed (bare-deleted)", async () => {
  const app = await setup();
  const res = await app.handle(
    new Request(EXPIRE_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }),
  );
  if (!res) throw new Error("No response from Oak app");
  // Oak's allowedMethods returns 405 for unknown method on a known prefix,
  // and 404 for unknown path; either signals "not routed".
  if (res.status !== 404 && res.status !== 405) {
    throw new Error(`expected 404/405, got ${res.status}`);
  }
});

Deno.test("GET /dashboard/bundles (query variant) is not routed (bare-deleted)", async () => {
  const app = await setup();
  const res = await app.handle(
    new Request(`${LIST_PATH}?ppPublicKey=G123`, { method: "GET" }),
  );
  if (!res) throw new Error("No response from Oak app");
  if (res.status !== 404 && res.status !== 405) {
    throw new Error(`expected 404/405, got ${res.status}`);
  }
});

Deno.test("GET /dashboard/bundles/:id is 410 Gone", async () => {
  const app = await setup();
  const res = await app.handle(
    new Request(`${LIST_PATH}/some-id`, { method: "GET" }),
  );
  if (!res) throw new Error("No response from Oak app");
  assertEquals(res.status, 410);
});
