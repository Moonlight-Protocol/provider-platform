import { create, getNumericDate } from "@zaubrik/djwt";
import { SERVICE_DOMAIN, SESSION_TTL } from "@/config/env.ts";
import { SERVICE_AUTH_SECRET_AS_CRYPTO_KEY_SIGNABLE } from "@/core/service/auth/service/service-auth-secret.ts";

export type JwtPayload = {
  iss: string;
  sub: string;
  iat: number;
  exp: number;
  sessionId: string;
};

export default async function (clientAccount: string, challengeHash: string) {
  const header = { alg: "HS256", typ: "JWT" } as const;

  // Hash the challengeHash so raw nonce material isn't visible in the JWT
  const sessionIdBytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(challengeHash))
  );
  const sessionId = Array.from(sessionIdBytes.slice(0, 16))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const payload = {
    iss: "https://" + SERVICE_DOMAIN,
    sub: clientAccount,
    iat: getNumericDate(0),
    exp: getNumericDate(SESSION_TTL),
    sessionId,
  };

  const secretKey = SERVICE_AUTH_SECRET_AS_CRYPTO_KEY_SIGNABLE;
  const jwt = await create(header, payload, secretKey);

  return jwt;
}
