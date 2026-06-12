/**
 * Phase 3 integration tests — GET /api/v1/providers/:ppPublicKey/entities.
 *
 * Exercises the handler (response envelope + updated_at DESC) against the
 * PGlite DB, and the requirePpOwnership middleware (owning operator passes,
 * non-owning operator is denied).
 *
 * NOTE on the deny status: requirePpOwnership returns 404 ("Provider not
 * found") for a PP the operator does not own — the same behaviour as every
 * other /providers/:pp endpoint (it does not distinguish "exists but not
 * yours" from "does not exist"). The ownership property the prompt asks for
 * (non-owner cannot read another PP's entities) holds; the status code is 404,
 * not 403.
 *
 * Run: deno test --allow-all --no-check \
 *   --config src/http/v1/entities/tests/deno.json src/http/v1/entities/tests/
 */
import { assertEquals } from "@std/assert";
import { drizzleClient, ensureInitialized, resetDb } from "./pglite_db.ts";
import {
  EntityStatus,
  seedApproval,
  seedEntity,
  seedPp,
  testPubkey,
} from "./seed.ts";
import { newNoop } from "@/utils/logger/index.ts";
import { PpEntityApprovalRepository } from "@/persistence/drizzle/repository/pp-entity-approval.repository.ts";
import { PpRepository } from "@/persistence/drizzle/repository/pp.repository.ts";
import {
  handleGetEntities,
  setEntitiesRepoForTests,
} from "@/http/v1/entities/get.ts";
import {
  requirePpOwnership,
  setPpRepoForOwnershipTests,
} from "@/http/middleware/require-pp-ownership.ts";

await ensureInitialized();
setEntitiesRepoForTests(new PpEntityApprovalRepository(drizzleClient));
setPpRepoForOwnershipTests(new PpRepository(drizzleClient));

const deps = { log: newNoop() };
const PP = "GPP_ENDPOINT_TEST";
const OWNER = "GOWNER_OPERATOR_A";
const OTHER = "GOTHER_OPERATOR_B";

interface MockCtxOpts {
  pp?: unknown;
  ppPublicKey?: string;
  sub?: string;
}

// deno-lint-ignore no-explicit-any
function mockCtx(opts: MockCtxOpts): any {
  return {
    state: {
      pp: opts.pp,
      session: opts.sub ? { sub: opts.sub } : undefined,
    },
    params: opts.ppPublicKey ? { ppPublicKey: opts.ppPublicKey } : undefined,
    response: { status: 0, body: undefined as unknown },
  };
}

Deno.test("GET entities: returns all statuses in updated_at DESC with { data } envelope", async () => {
  await resetDb();
  await seedPp({ publicKey: PP, ownerPublicKey: OWNER });

  const approved = testPubkey();
  const unverified = testPubkey();
  const blocked = testPubkey();

  await seedEntity({ pubkey: approved, name: "Acme", jurisdictions: ["US"] });

  await seedApproval({
    ppPublicKey: PP,
    accountPubkey: blocked,
    status: EntityStatus.BLOCKED,
    updatedAt: new Date("2024-01-01T00:00:00.000Z"),
  });
  await seedApproval({
    ppPublicKey: PP,
    accountPubkey: approved,
    status: EntityStatus.APPROVED,
    updatedAt: new Date("2024-03-01T00:00:00.000Z"),
  });
  await seedApproval({
    ppPublicKey: PP,
    accountPubkey: unverified,
    status: EntityStatus.UNVERIFIED,
    updatedAt: new Date("2024-02-01T00:00:00.000Z"),
  });

  const handler = handleGetEntities(deps);
  const ctx = mockCtx({ pp: { publicKey: PP } });
  await handler(ctx);

  assertEquals(ctx.response.status, 200);
  const data = ctx.response.body.data as Array<Record<string, unknown>>;
  assertEquals(data.map((d) => d.pubkey), [approved, unverified, blocked]);
  assertEquals(data.map((d) => d.status), [
    EntityStatus.APPROVED,
    EntityStatus.UNVERIFIED,
    EntityStatus.BLOCKED,
  ]);
  // Identity joined for the approved entity; null for the unauthorized pubkeys.
  assertEquals(data[0].name, "Acme");
  assertEquals(data[0].jurisdictions, ["US"]);
  assertEquals(data[1].name, null);
});

Deno.test("ownership: owning operator passes the middleware (next called, pp populated)", async () => {
  await resetDb();
  await seedPp({ publicKey: PP, ownerPublicKey: OWNER });

  const mw = requirePpOwnership(deps);
  const ctx = mockCtx({ ppPublicKey: PP, sub: OWNER });
  let nextCalled = false;
  await mw(ctx, () => {
    nextCalled = true;
    return Promise.resolve();
  });

  assertEquals(nextCalled, true);
  assertEquals((ctx.state.pp as { publicKey: string }).publicKey, PP);
});

Deno.test("ownership: non-owning operator is denied (404, next NOT called)", async () => {
  await resetDb();
  await seedPp({ publicKey: PP, ownerPublicKey: OWNER });

  const mw = requirePpOwnership(deps);
  const ctx = mockCtx({ ppPublicKey: PP, sub: OTHER });
  let nextCalled = false;
  await mw(ctx, () => {
    nextCalled = true;
    return Promise.resolve();
  });

  assertEquals(nextCalled, false);
  assertEquals(ctx.response.status, 404);
  assertEquals(ctx.state.pp, undefined);
});
