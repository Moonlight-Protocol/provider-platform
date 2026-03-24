import { create, getNumericDate } from "@zaubrik/djwt";
import { SERVICE_DOMAIN, SESSION_TTL } from "@/config/env.ts";
import { SERVICE_AUTH_SECRET_AS_CRYPTO_KEY_SIGNABLE } from "@/core/service/auth/service/service-auth-secret.ts";

export type JwtPayload = {
  iss: string;
  sub: string;
  iat: number;
  exp: number;
  sessionId: string;
  type?: "sep10" | "custodial";
};

export default async function (
  clientAccount: string,
  challengeHash: string,
  opts?: { type?: "sep10" | "custodial" },
) {
  const header = { alg: "HS256", typ: "JWT" } as const;

  const payload: Record<string, unknown> = {
    iss: "https://" + SERVICE_DOMAIN,
    sub: clientAccount,
    iat: getNumericDate(0),
    exp: getNumericDate(SESSION_TTL),
    sessionId: challengeHash,
  };

  if (opts?.type) {
    payload.type = opts.type;
  }

  const secretKey = SERVICE_AUTH_SECRET_AS_CRYPTO_KEY_SIGNABLE;
  const jwt = await create(header, payload, secretKey);

  return jwt;
}
