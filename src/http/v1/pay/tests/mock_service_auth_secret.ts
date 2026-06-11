/**
 * Test mock for @/core/service/auth/service/service-auth-secret.ts.
 *
 * The real module imports @/config/env.ts (MODE, SERVICE_AUTH_SECRET). env.ts
 * eagerly evaluates every requireEnv at module load — a deliberate production
 * fail-fast — so merely importing it (which the auth-middleware chain does)
 * pulls the real env into the pay unit-test graph. Under `deno test --parallel`
 * on a cold CI cache that becomes a load-order race ("DATABASE_URL is not
 * loaded"). The pay tests already mock config.ts/logger/jwt/channel deps; this
 * completes the isolation so they never evaluate the real env.ts.
 *
 * Mirrors the real module's exports + crypto-key shape with a fixed test
 * secret. Production service-auth-secret.ts is untouched.
 */
const TEST_SECRET = "test-auth-secret";

async function importSecret(secret: string, isSignable?: boolean) {
  const keyData = new TextEncoder().encode(secret);
  return await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" } as const,
    false,
    ["verify" as const, ...(isSignable ? ["sign" as const] : [])],
  );
}

export const authSecret = TEST_SECRET;
export const SERVICE_AUTH_SECRET_AS_CRYPTO_KEY = await importSecret(
  TEST_SECRET,
);
export const SERVICE_AUTH_SECRET_AS_CRYPTO_KEY_SIGNABLE = await importSecret(
  TEST_SECRET,
  true,
);
