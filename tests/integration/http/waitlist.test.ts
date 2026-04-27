import "../../ensure_test_env.ts";
import { Application, Router } from "@oak/oak";
import { assertEquals } from "jsr:@std/assert";
import { ensureInitialized, resetDb, getTestDb } from "../../test_helpers.ts";
import { waitlistRequest } from "@/persistence/drizzle/entity/index.ts";
import { WaitlistRequestRepository } from "@/persistence/drizzle/repository/waitlist-request.repository.ts";
// deno-lint-ignore-file no-explicit-any

const WAITLIST_PATH = "http://localhost/api/v1/waitlist";

// We import the route module *after* PGlite is wired up (tests/deno.json
// remaps @/persistence/drizzle/config.ts to our pglite_db.ts).
const { default: waitlistRouter, setWaitlistRepoForTests } = await import(
  "@/http/v1/waitlist/routes.ts"
);

function createTestApp(): Application {
  const app = new Application();
  const router = new Router();
  router.use("/api/v1", waitlistRouter.routes(), waitlistRouter.allowedMethods());
  app.use(router.routes());
  app.use(router.allowedMethods());
  return app;
}

async function postWaitlist(app: Application, body: unknown) {
  const response = await app.handle(
    new Request(WAITLIST_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  if (!response) throw new Error("No response from Oak app");
  return response;
}

async function setup() {
  await ensureInitialized();
  await resetDb();
  const repo = new WaitlistRequestRepository(getTestDb() as any);
  setWaitlistRepoForTests(repo);
  return { app: createTestApp(), repo };
}

// ── Suite init ──────────────────────────────────────────────────────────

Deno.test({
  name: "waitlist suite setup",
  async fn() {
    await ensureInitialized();
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

// ── Validation ──────────────────────────────────────────────────────────

Deno.test("returns 400 for missing email", async () => {
  const { app } = await setup();
  const res = await postWaitlist(app, { walletPublicKey: "GABC" });
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.message, "Invalid email");
});

Deno.test("returns 400 for invalid email", async () => {
  const { app } = await setup();
  const res = await postWaitlist(app, { email: "not-an-email" });
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.message, "Invalid email");
});

Deno.test("returns 400 for email over 254 chars", async () => {
  const { app } = await setup();
  const longEmail = "a".repeat(250) + "@b.co";
  const res = await postWaitlist(app, { email: longEmail });
  assertEquals(res.status, 400);
});

// ── Success ─────────────────────────────────────────────────────────────

Deno.test("returns 201 and persists new waitlist request", async () => {
  const { app } = await setup();
  const res = await postWaitlist(app, {
    email: "alice@example.com",
    walletPublicKey: "GABCDEF",
  });
  assertEquals(res.status, 201);
  const body = await res.json();
  assertEquals(body.message, "Added to waitlist");

  // Verify DB row
  const db = getTestDb();
  const rows = await db.select().from(waitlistRequest);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].email, "alice@example.com");
  assertEquals(rows[0].walletPublicKey, "GABCDEF");
  assertEquals(rows[0].source, "provider-console");
});

Deno.test("returns 201 without walletPublicKey", async () => {
  const { app } = await setup();
  const res = await postWaitlist(app, { email: "bob@example.com" });
  assertEquals(res.status, 201);

  const db = getTestDb();
  const rows = await db.select().from(waitlistRequest);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].walletPublicKey, null);
});

// ── Dedup ───────────────────────────────────────────────────────────────

Deno.test("returns 200 on duplicate wallet and updates email", async () => {
  const { app } = await setup();

  const first = await postWaitlist(app, {
    email: "first@example.com",
    walletPublicKey: "GDUP",
  });
  assertEquals(first.status, 201);

  const second = await postWaitlist(app, {
    email: "updated@example.com",
    walletPublicKey: "GDUP",
  });
  assertEquals(second.status, 200);

  const db = getTestDb();
  const rows = await db.select().from(waitlistRequest);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].email, "updated@example.com");
});
