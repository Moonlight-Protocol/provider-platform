// deno-lint-ignore-file no-explicit-any
import "../../ensure_test_env.ts";
import { Application, Router } from "@oak/oak";
import { assertEquals } from "@std/assert";
import { eq } from "drizzle-orm";
import { ensureInitialized, getTestDb, resetDb } from "../../test_helpers.ts";
import { newNoop } from "@/utils/logger/index.ts";
import { paymentProvider } from "@/persistence/drizzle/entity/pp.entity.ts";
import {
  councilMembership,
  CouncilMembershipStatus,
} from "@/persistence/drizzle/entity/council-membership.entity.ts";

const REMOVED_PATH = "http://localhost/api/v1/council/removed";
const CHANNEL_AUTH = "CCHANNELAUTH";
const PP_PK = "GPROVIDERPUBLICKEY";
const COUNCIL_URL = "http://council.test";

// Imported after PGlite is wired up (tests/deno.json remaps the db config).
const { buildCouncilRouter } = await import("@/http/v1/council/routes.ts");

function createTestApp(): Application {
  const app = new Application();
  const router = new Router();
  const councilRouter = buildCouncilRouter({ log: newNoop() });
  router.use(
    "/api/v1",
    councilRouter.routes(),
    councilRouter.allowedMethods(),
  );
  app.use(router.routes());
  app.use(router.allowedMethods());
  return app;
}

async function seedActiveMembership() {
  const db = getTestDb();
  // resetDb() doesn't clear these tables; clear them here for isolation.
  await db.delete(councilMembership);
  await db.delete(paymentProvider);
  await db.insert(paymentProvider).values({
    id: "pp-1",
    publicKey: PP_PK,
    encryptedSk: "enc",
    derivationIndex: 0,
    isActive: true,
  });
  await db.insert(councilMembership).values({
    id: "m-1",
    councilUrl: COUNCIL_URL,
    councilPublicKey: "GCOUNCIL",
    channelAuthId: CHANNEL_AUTH,
    status: CouncilMembershipStatus.ACTIVE,
    ppPublicKey: PP_PK,
  });
}

/** Run `fn` with global fetch replaced by a stub returning `httpStatus`. */
async function withCouncilStatus(
  httpStatus: number,
  fn: () => Promise<void>,
): Promise<void> {
  const orig = globalThis.fetch;
  globalThis.fetch = ((_input: any) =>
    Promise.resolve(
      new Response(JSON.stringify({ status: "stub" }), { status: httpStatus }),
    )) as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = orig;
  }
}

async function postRemoved(app: Application, body: unknown): Promise<Response> {
  const res = await app.handle(
    new Request(REMOVED_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  if (!res) throw new Error("No response from Oak app");
  return res;
}

async function membershipStatus(): Promise<string> {
  const db = getTestDb();
  const [row] = await db
    .select()
    .from(councilMembership)
    .where(eq(councilMembership.id, "m-1"));
  return row.status;
}

Deno.test({
  name: "council-removed suite setup",
  async fn() {
    await ensureInitialized();
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test("400 when councilId is missing", async () => {
  await ensureInitialized();
  await resetDb();
  const app = createTestApp();
  const res = await postRemoved(app, {});
  assertEquals(res.status, 400);
  await res.body?.cancel();
});

Deno.test("council confirms removal (404) → membership demoted to REJECTED", async () => {
  await ensureInitialized();
  await resetDb();
  await seedActiveMembership();
  const app = createTestApp();

  await withCouncilStatus(404, async () => {
    const res = await postRemoved(app, { councilId: CHANNEL_AUTH });
    assertEquals(res.status, 202);
    const body = await res.json();
    assertEquals(body.deactivated, 1);
  });

  assertEquals(await membershipStatus(), CouncilMembershipStatus.REJECTED);
});

Deno.test("council still reports ACTIVE (200) → membership untouched", async () => {
  await ensureInitialized();
  await resetDb();
  await seedActiveMembership();
  const app = createTestApp();

  await withCouncilStatus(200, async () => {
    const res = await postRemoved(app, { councilId: CHANNEL_AUTH });
    assertEquals(res.status, 202);
    const body = await res.json();
    assertEquals(body.deactivated, 0);
  });

  assertEquals(await membershipStatus(), CouncilMembershipStatus.ACTIVE);
});
