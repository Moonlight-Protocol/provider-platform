/**
 * Mock JWT generator for tests.
 *
 * Replaces @/core/service/auth/generate-jwt.ts so that login/register
 * handlers can issue tokens without needing SERVICE_AUTH_SECRET or env vars.
 */

export type JwtPayload = {
  iss: string;
  sub: string;
  iat: number;
  exp: number;
  sessionId: string;
  type?: "sep10" | "custodial";
};

// deno-lint-ignore require-await -- mock satisfies generateJwt's Promise<string> contract
export default async function generateJwt(
  clientAccount: string,
  _challengeHash: string,
  opts?: { type?: "sep10" | "custodial" },
): Promise<string> {
  // Return a deterministic token for tests
  const typePrefix = opts?.type ?? "sep10";
  return `mock-jwt-${typePrefix}-${clientAccount}`;
}
