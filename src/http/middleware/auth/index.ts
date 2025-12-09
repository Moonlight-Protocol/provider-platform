import type { Context } from "@oak/oak";
import { verify } from "@zaubrik/djwt";
import { SERVICE_AUTH_SECRET_AS_CRYPTO_KEY } from "@/core/service/auth/service/service-auth-secret.ts";
import type { JwtPayload } from "@/core/service/auth/generate-jwt.ts";
import { isDefined } from "@/utils/type-guards/is-defined.ts";
import * as E from "@/http/middleware/auth/error.ts";
import { PIPE_APIError } from "@/http/pipelines/error-pipeline.ts";

export async function jwtMiddleware(
  ctx: Context,
  next: () => Promise<unknown>
) {
  const authorization = ctx.request.headers.get("authorization");
  if (!isDefined(authorization)) {
    return await PIPE_APIError(ctx).run(new E.MISSING_AUTHORIZATION_HEADER());
  }

  const parts = authorization.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return await PIPE_APIError(ctx).run(new E.INVALID_AUTHORIZATION_HEADER());
  }
  const token = parts[1];

  try {
    const secretKey = SERVICE_AUTH_SECRET_AS_CRYPTO_KEY;
    // verify() will throw if verification fails.
    const payload = await verify(token, secretKey);

    // Optionally, you can decode the token to inspect all fields
    // (verify already returns the payload if )
    // const payload = decode(token);

    // Check expiration manually if needed
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp === "number" && now > payload.exp) {
      return await PIPE_APIError(ctx).run(new E.EXPIRED_TOKEN());
    }

    // Attach the verified payload to ctx.state for later use.
    ctx.state.session = payload;
  } catch (error) {
    return await PIPE_APIError(ctx).run(new E.JWT_VERIFICATION_FAILED(error));
  }
  await next();
}

export type JwtSessionData = JwtPayload;
