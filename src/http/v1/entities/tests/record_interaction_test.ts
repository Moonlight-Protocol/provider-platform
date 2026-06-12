/**
 * Phase 1 unit tests — PpEntityApprovalRepository.recordInteraction invariant
 * + listByPp ordering/join.
 *
 * Run: deno test --allow-all --no-check \
 *   --config src/http/v1/entities/tests/deno.json src/http/v1/entities/tests/
 */
import { assertEquals } from "@std/assert";
import { drizzleClient, ensureInitialized, resetDb } from "./pglite_db.ts";
import { EntityStatus, seedApproval, seedEntity, testPubkey } from "./seed.ts";
import { PpEntityApprovalRepository } from "@/persistence/drizzle/repository/pp-entity-approval.repository.ts";

await ensureInitialized();
const repo = new PpEntityApprovalRepository(drizzleClient);

const PP = "GPP_RECORD_TEST";

Deno.test("recordInteraction: inserts an UNVERIFIED row when none exists", async () => {
  await resetDb();
  const pk = testPubkey();

  await repo.recordInteraction(PP, pk);

  const row = await repo.findByPpAndAccount(PP, pk);
  assertEquals(row?.status, EntityStatus.UNVERIFIED);
  // Fresh insert: created_at and updated_at default to the same now().
  assertEquals(row!.createdAt.getTime(), row!.updatedAt.getTime());
});

Deno.test("recordInteraction: touches updated_at on an existing UNVERIFIED row (status untouched)", async () => {
  await resetDb();
  const pk = testPubkey();
  const old = new Date("2020-01-01T00:00:00.000Z");
  await seedApproval({
    ppPublicKey: PP,
    accountPubkey: pk,
    status: EntityStatus.UNVERIFIED,
    createdAt: old,
    updatedAt: old,
  });

  await repo.recordInteraction(PP, pk);

  const row = await repo.findByPpAndAccount(PP, pk);
  assertEquals(row?.status, EntityStatus.UNVERIFIED);
  // updated_at bumped forward; created_at preserved.
  assertEquals(row!.updatedAt.getTime() > old.getTime(), true);
  assertEquals(row!.createdAt.getTime(), old.getTime());
});

Deno.test("recordInteraction: no-op on an APPROVED row (never downgrades, never touches)", async () => {
  await resetDb();
  const pk = testPubkey();
  const old = new Date("2020-01-01T00:00:00.000Z");
  await seedApproval({
    ppPublicKey: PP,
    accountPubkey: pk,
    status: EntityStatus.APPROVED,
    createdAt: old,
    updatedAt: old,
  });

  await repo.recordInteraction(PP, pk);

  const row = await repo.findByPpAndAccount(PP, pk);
  assertEquals(row?.status, EntityStatus.APPROVED);
  // Untouched: updated_at stays at the seeded value.
  assertEquals(row!.updatedAt.getTime(), old.getTime());
});

Deno.test("recordInteraction: no-op on a BLOCKED row", async () => {
  await resetDb();
  const pk = testPubkey();
  const old = new Date("2020-01-01T00:00:00.000Z");
  await seedApproval({
    ppPublicKey: PP,
    accountPubkey: pk,
    status: EntityStatus.BLOCKED,
    createdAt: old,
    updatedAt: old,
  });

  await repo.recordInteraction(PP, pk);

  const row = await repo.findByPpAndAccount(PP, pk);
  assertEquals(row?.status, EntityStatus.BLOCKED);
  assertEquals(row!.updatedAt.getTime(), old.getTime());
});

Deno.test("recordInteraction: no-op on a PENDING row", async () => {
  await resetDb();
  const pk = testPubkey();
  const old = new Date("2020-01-01T00:00:00.000Z");
  await seedApproval({
    ppPublicKey: PP,
    accountPubkey: pk,
    status: EntityStatus.PENDING,
    createdAt: old,
    updatedAt: old,
  });

  await repo.recordInteraction(PP, pk);

  const row = await repo.findByPpAndAccount(PP, pk);
  assertEquals(row?.status, EntityStatus.PENDING);
  assertEquals(row!.updatedAt.getTime(), old.getTime());
});

Deno.test("listByPp: returns rows newest-first with entity identity joined (null when no entity)", async () => {
  await resetDb();
  const approved = testPubkey();
  const unverified = testPubkey();
  const blocked = testPubkey();

  // approved has an entity record; the other two do not (unauthorized pubkeys).
  await seedEntity({
    pubkey: approved,
    name: "Acme Corp",
    jurisdictions: ["US", "DE"],
  });

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

  const rows = await repo.listByPp(PP);

  assertEquals(rows.map((r) => r.accountPubkey), [
    approved, // 2024-03
    unverified, // 2024-02
    blocked, // 2024-01
  ]);
  assertEquals(rows[0].name, "Acme Corp");
  assertEquals(rows[0].jurisdictions, ["US", "DE"]);
  // Unauthorized pubkey with no entity record → identity is null.
  assertEquals(rows[1].name, null);
  assertEquals(rows[1].jurisdictions, null);
});

Deno.test("listByPp: scopes to the PP and excludes soft-deleted rows", async () => {
  await resetDb();
  const mine = testPubkey();
  const other = testPubkey();
  const deleted = testPubkey();

  await seedApproval({
    ppPublicKey: PP,
    accountPubkey: mine,
    status: EntityStatus.UNVERIFIED,
  });
  await seedApproval({
    ppPublicKey: "GPP_OTHER",
    accountPubkey: other,
    status: EntityStatus.UNVERIFIED,
  });
  await seedApproval({
    ppPublicKey: PP,
    accountPubkey: deleted,
    status: EntityStatus.UNVERIFIED,
    deletedAt: new Date(),
  });

  const rows = await repo.listByPp(PP);
  assertEquals(rows.map((r) => r.accountPubkey), [mine]);
});
