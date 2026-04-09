// deno-lint-ignore-file no-explicit-any
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/persistence/drizzle/entity/index.ts";
import { OperationsBundleRepository } from "@/persistence/drizzle/repository/operations-bundle.repository.ts";
import { BundleStatus } from "@/persistence/drizzle/entity/operations-bundle.entity.ts";
import { TransactionStatus } from "@/persistence/drizzle/entity/transaction.entity.ts";
import {
  operationsBundle,
  transaction,
  bundleTransaction,
} from "@/persistence/drizzle/entity/index.ts";

// ---------------------------------------------------------------------------
// Module-level singletons (lazily initialised once per test run)
// ---------------------------------------------------------------------------

let _pglite: PGlite | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Returns the live PGlite-backed drizzle client.
 * Throws if `ensureInitialized()` has not been called.
 */
export function getTestDb(): TestDb {
  if (!_db) throw new Error("Test DB not initialized – call ensureInitialized() first");
  return _db;
}

/**
 * Returns an `OperationsBundleRepository` wired to the test PGlite db.
 */
export function getBundleRepo(): OperationsBundleRepository {
  return new OperationsBundleRepository(getTestDb() as any);
}

// ---------------------------------------------------------------------------
// Migration runner
// ---------------------------------------------------------------------------

const MIGRATION_FOLDER = new URL(
  "../src/persistence/drizzle/migration",
  import.meta.url,
).pathname;

const MIGRATION_FILES = [
  "0000_init.sql",
  "0001_add_operations_mlxdr_to_bundles.sql",
  "0002_add_processing_status_to_bundle.sql",
  "0003_add_fee_to_bundles.sql",
  "0004_add_failed_status_to_transaction.sql",
  "0005_young_kabuki.sql",
  "0006_pay_tables.sql",
  "0007_add_retry_fail_reason_fields.sql",
  "0008_uc2_council_memberships_and_providers.sql",
];

async function runMigrations(pg: PGlite): Promise<void> {
  for (const file of MIGRATION_FILES) {
    const sql = await Deno.readTextFile(`${MIGRATION_FOLDER}/${file}`);
    // Drizzle marks statement boundaries with "--> statement-breakpoint"
    const statements = sql
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);

    for (const stmt of statements) {
      await pg.exec(stmt);
    }
  }
}

// ---------------------------------------------------------------------------
// Public init / reset helpers
// ---------------------------------------------------------------------------

/**
 * Boots PGlite, runs all migrations, and wires up the shared drizzle client.
 * Safe to call multiple times – subsequent calls are no-ops.
 */
export async function ensureInitialized(): Promise<void> {
  if (_db) return;

  _pglite = new PGlite();
  await runMigrations(_pglite);

  _db = drizzle(_pglite, { schema });
}

/**
 * Truncates all mutable tables between tests (order respects FK constraints).
 */
export async function resetDb(): Promise<void> {
  const db = getTestDb();
  await db.delete(bundleTransaction);
  await db.delete(transaction);
  await db.delete(operationsBundle);
}

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

export type SeedBundleOpts = {
  id?: string;
  status?: BundleStatus;
  retryCount?: number;
  lastFailureReason?: string | null;
  fee?: bigint;
  ttl?: Date;
  operationsMLXDR?: string[];
  createdAt?: Date;
};

/**
 * Inserts a single `operations_bundles` row and returns the inserted record.
 */
export async function seedBundle(opts: SeedBundleOpts = {}) {
  const db = getTestDb();
  const id = opts.id ?? testBundleId();
  const now = new Date();

  const [row] = await db
    .insert(operationsBundle)
    .values({
      id,
      status: opts.status ?? BundleStatus.PENDING,
      retryCount: opts.retryCount ?? 0,
      lastFailureReason: opts.lastFailureReason ?? null,
      fee: opts.fee ?? BigInt(100),
      ttl: opts.ttl ?? new Date(now.getTime() + 60_000),
      operationsMLXDR: opts.operationsMLXDR ?? [],
      createdAt: opts.createdAt ?? now,
      updatedAt: now,
    })
    .returning();

  return row;
}

export type SeedTransactionOpts = {
  id?: string;
  status?: TransactionStatus;
  bundleIds?: string[];
};

/**
 * Inserts a `transactions` row and links it to the supplied bundle IDs via
 * `bundles_transactions`.
 */
export async function seedTransaction(opts: SeedTransactionOpts = {}) {
  const db = getTestDb();
  const id = opts.id ?? `tx-${crypto.randomUUID()}`;
  const now = new Date();

  const [row] = await db
    .insert(transaction)
    .values({
      id,
      status: opts.status ?? TransactionStatus.UNVERIFIED,
      timeout: new Date(now.getTime() + 300_000),
      ledgerSequence: "12345",
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  for (const bundleId of opts.bundleIds ?? []) {
    await db.insert(bundleTransaction).values({
      bundleId,
      transactionId: id,
      createdAt: now,
      updatedAt: now,
    });
  }

  return row;
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

let _bundleCounter = 0;

/** Returns a deterministic, unique-per-run bundle ID suitable for tests. */
export function testBundleId(): string {
  return `test-bundle-${++_bundleCounter}`;
}
