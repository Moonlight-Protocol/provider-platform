/**
 * Side-effect import: defaults all env vars required by `@/config/env.ts` so
 * integration tests can run on a fresh clone without a `.env` file. Existing
 * `.env`-backed dev/CI flows are unaffected — each default is only applied
 * when the env var is unset.
 */
function setDefault(key: string, value: string): void {
  if (Deno.env.get(key) === undefined) Deno.env.set(key, value);
}

setDefault("PORT", "8000");
setDefault("MODE", "development");
setDefault("LOG_LEVEL", "ERROR");
setDefault("DATABASE_URL", "postgres://test:test@localhost:5432/test");
setDefault("SERVICE_DOMAIN", "test.local");
setDefault(
  "SERVICE_AUTH_SECRET",
  "dGVzdHRlc3R0ZXN0dGVzdHRlc3R0ZXN0dGVzdHRlc3Q=",
);
setDefault("CHALLENGE_TTL", "900");
setDefault("SESSION_TTL", "21600");
setDefault("NETWORK", "testnet");
setDefault("NETWORK_FEE", "1000000");
setDefault("MEMPOOL_SLOT_CAPACITY", "10");
setDefault("MEMPOOL_EXPENSIVE_OP_WEIGHT", "10");
setDefault("MEMPOOL_CHEAP_OP_WEIGHT", "1");
setDefault("MEMPOOL_EXECUTOR_INTERVAL_MS", "1000");
setDefault("MEMPOOL_VERIFIER_INTERVAL_MS", "1000");
setDefault("MEMPOOL_TTL_CHECK_INTERVAL_MS", "5000");
setDefault("MEMPOOL_MAX_RETRY_ATTEMPTS", "3");
setDefault("BUNDLE_MAX_OPERATIONS", "20");
