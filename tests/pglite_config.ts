// deno-lint-ignore-file no-explicit-any
/**
 * Drop-in replacement for @/persistence/drizzle/config.ts in integration tests.
 *
 * Re-exports the PGlite-backed drizzle client from test_helpers so that
 * production modules that import `drizzleClient` resolve to the test DB.
 */
import { getTestDb, type TestDb } from "./test_helpers.ts";

// Lazy proxy — defers to getTestDb() so the real PGlite instance doesn't
// need to exist until ensureInitialized() has been called.
const drizzleClientProxy: TestDb = new Proxy({} as TestDb, {
  get(_target, prop) {
    const real = getTestDb();
    const val = (real as any)[prop];
    return typeof val === "function" ? val.bind(real) : val;
  },
});

export const drizzleClient = drizzleClientProxy;
export type DrizzleClient = TestDb;
