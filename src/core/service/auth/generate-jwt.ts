import { create, getNumericDate } from "https://deno.land/x/djwt/mod.ts";
import { SERVICE_DOMAIN, SESSION_TTL } from "@/config/env.ts";
import { SERVICE_AUTH_SECRET_AS_CRYPTO_KEY_SIGNABLE } from "./service/service-auth-secret.ts";

export type JwtPayload = {
  iss: string;
  sub: string;
  iat: number;
  exp: number;
  sessionId: string;
};

export default async function (clientAccount: string, challengeHash: string) {
  const header = { alg: "HS256", typ: "JWT" } as const;

  const payload = {
    iss: "https://" + SERVICE_DOMAIN,
    sub: clientAccount,
    iat: getNumericDate(Date.now() / 1000),
    exp: getNumericDate(Date.now() / 1000 + SESSION_TTL),
    sessionId: challengeHash,
  };

  const secretKey = SERVICE_AUTH_SECRET_AS_CRYPTO_KEY_SIGNABLE;
  const jwt = await create(header, payload, secretKey);
  
  return jwt;
}
