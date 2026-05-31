import type { Context } from "@oak/oak";
import { verify } from "@zaubrik/djwt";
import { SERVICE_AUTH_SECRET_AS_CRYPTO_KEY } from "@/core/service/auth/service/service-auth-secret.ts";
import type { JwtPayload } from "@/core/service/auth/generate-jwt.ts";
import type { Logger } from "@/utils/logger/index.ts";
import { isDefined } from "@/utils/type-guards/is-defined.ts";
import * as E from "@/http/middleware/auth/error.ts";
import { PIPE_APIError } from "@/http/pipelines/error-pipeline.ts";

export function jwtMiddleware(
  deps: { log: Logger },
): (ctx: Context, next: () => Promise<unknown>) => Promise<void> {
  return async (ctx, next) => {
    const authorization = ctx.request.headers.get("authorization");
    if (!isDefined(authorization)) {
      await PIPE_APIError(ctx, deps).run(new E.MISSING_AUTHORIZATION_HEADER());
      return;
    }

    const parts = authorization.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer") {
      await PIPE_APIError(ctx, deps).run(new E.INVALID_AUTHORIZATION_HEADER());
      return;
    }
    const token = parts[1];

    try {
      const secretKey = SERVICE_AUTH_SECRET_AS_CRYPTO_KEY;
      const payload = await verify(token, secretKey);

      const now = Math.floor(Date.now() / 1000);
      if (typeof payload.exp === "number" && now > payload.exp) {
        await PIPE_APIError(ctx, deps).run(new E.EXPIRED_TOKEN());
        return;
      }

      ctx.state.session = payload;
    } catch (error) {
      await PIPE_APIError(ctx, deps).run(
        new E.JWT_VERIFICATION_FAILED(error),
      );
      return;
    }
    await next();
  };
}

export type JwtSessionData = JwtPayload;
