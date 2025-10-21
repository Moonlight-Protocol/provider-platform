import { Context } from "@oak/oak";
import { verify } from "https://deno.land/x/djwt/mod.ts";
import { SERVICE_AUTH_SECRET_AS_CRYPTO_KEY } from "../../../services/auth/service/service-auth-secret.ts";
import { JwtPayload } from "../../../services/auth/generate-jwt.ts";

export async function jwtMiddleware(
  ctx: Context,
  next: () => Promise<unknown>
) {
  console.log("jwtMiddleware");
  const authorization = ctx.request.headers.get("authorization");
  if (!authorization) {
    ctx.response.status = 401;
    ctx.response.body = { error: "Missing authorization header" };
    return;
  }

  const parts = authorization.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    ctx.response.status = 401;
    ctx.response.body = { error: "Invalid authorization header format" };
    return;
  }
  const token = parts[1];

  try {
    const secretKey = SERVICE_AUTH_SECRET_AS_CRYPTO_KEY;
    // verify() will throw if verification fails.
    const payload = await verify(token, secretKey);

    // Optionally, you can decode the token to inspect all fields
    // (verify already returns the payload if successful)
    // const payload = decode(token);

    // Check expiration manually if needed
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp === "number" && now > payload.exp) {
      ctx.response.status = 401;
      ctx.response.body = { error: "JWT has expired" };
      return;
    }

    // Attach the verified payload to ctx.state for later use.
    ctx.state.session = payload;

    await next();
  } catch (error) {
    console.error("JWT verification failed:", error);
    ctx.response.status = 401;
    ctx.response.body = { error: "JWT verification failed" };
    return;
  }
}

export type JwtSessionData = JwtPayload;
