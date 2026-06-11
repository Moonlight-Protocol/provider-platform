// deno-lint-ignore-file no-explicit-any
/**
 * PGlite-backed test database for the entities-interaction tests.
 *
 * Mirrors src/http/v1/pay/tests/pglite_db.ts: PGlite (in-memory PostgreSQL via
 * WASM) + Drizzle, runs the real migrations from _journal.json so the schema
 * stays in sync, and overrides @/persistence/drizzle/config.ts via the test
 * deno.json import map.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/persistence/drizzle/entity/index.ts";

const MIGRATION_FOLDER = new URL(
  "../../../../persistence/drizzle/migration",
  import.meta.url,
).pathname;

interface JournalEntry {
  idx: number;
  tag: string;
}

async function runMigrations(pg: PGlite): Promise<void> {
  const journalRaw = await Deno.readTextFile(
    `${MIGRATION_FOLDER}/meta/_journal.json`,
  );
  const journal = JSON.parse(journalRaw);
  const entries: JournalEntry[] = journal.entries;

  for (const entry of entries) {
    const sql = await Deno.readTextFile(
      `${MIGRATION_FOLDER}/${entry.tag}.sql`,
    );
    const statements = sql
      .split("--> statement-breakpoint")
      .map((s: string) => s.trim())
      .filter(Boolean);

    for (const stmt of statements) {
      await pg.exec(stmt);
    }
  }
}

type PGliteDrizzle = ReturnType<typeof drizzle<typeof schema>>;

let pg: PGlite;
let _drizzleClient: PGliteDrizzle;
let _initialized = false;

async function ensureInitialized() {
  if (_initialized) return;

  pg = new PGlite();
  await runMigrations(pg);

  _drizzleClient = drizzle({ client: pg, schema });
  _initialized = true;
}

// Lazy proxy: modules import `drizzleClient` at load time, before
// ensureInitialized() runs. Forward access to the real client once it exists.
const drizzleClientProxy: PGliteDrizzle = new Proxy({} as PGliteDrizzle, {
  get(_target, prop) {
    if (!_initialized) {
      throw new Error(
        "PGlite not initialized. Call ensureInitialized() before using drizzleClient.",
      );
    }
    const val = (_drizzleClient as any)[prop];
    return typeof val === "function" ? val.bind(_drizzleClient) : val;
  },
});

export const drizzleClient = drizzleClientProxy;
export type DrizzleClient = PGliteDrizzle;

export { ensureInitialized };

/** Truncate the tables these tests touch. Call between tests for a clean slate. */
export async function resetDb(): Promise<void> {
  await ensureInitialized();
  await pg.exec(`
    TRUNCATE TABLE pp_entity_approvals, accounts, entities, payment_providers CASCADE;
  `);
}

/** Shut down PGlite. Call after all tests are done. */
export async function closeDb(): Promise<void> {
  if (_initialized) {
    await pg.close();
    _initialized = false;
  }
}
