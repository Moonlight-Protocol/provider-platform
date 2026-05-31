import { z } from "zod";
import { type Context, Status } from "@oak/oak";
import { P_VerifyChallenge } from "@/core/service/auth/challenge/verify/verify-challenge.ts";
import { P_UpdateChallengeSession } from "@/core/service/auth/challenge/store/update-challenge-session.ts";
import { P_UpdateChallengeDB } from "@/core/service/auth/challenge/store/update-challenge-db.ts";
import { P_GenerateChallengeJWT } from "@/core/service/auth/challenge/create/generate-challenge-jwt.ts";
import type { PostEndpointOutput } from "@/http/pipelines/types.ts";
import { PIPE_PostEndpoint } from "@/http/pipelines/post-endpoint.ts";
import { P_CompareChallenge } from "@/core/service/auth/challenge/verify/compare-challenge.ts";
import type { ContextWithJWT } from "@/core/service/auth/challenge/types.ts";
import type { Logger } from "@/utils/logger/index.ts";

export const requestSchema = z.object({
  signedChallenge: z.string(),
});

export const responseSchema = z.object({
  jwt: z.string(),
});

export function handlePostAuth(
  deps: { log: Logger },
): (ctx: Context) => Promise<unknown> {
  const log = deps.log.scope("postAuth");

  const assembleResponse = (
    input: ContextWithJWT,
  ): PostEndpointOutput<typeof responseSchema> => {
    log.event("auth challenge verified successfully");

    return {
      ctx: input.ctx,
      status: Status.OK,
      message: "Auth challenge verified successfully",
      data: {
        jwt: input.jwt,
      },
    };
  };

  return (ctx) => {
    log.info("postAuth");
    const handler = PIPE_PostEndpoint({
      name: "PostAuthEndpointPipeline",
      requestSchema: requestSchema,
      responseSchema: responseSchema,
      steps: [
        P_VerifyChallenge(deps),
        P_CompareChallenge(deps),
        P_GenerateChallengeJWT(deps),
        P_UpdateChallengeSession(deps),
        P_UpdateChallengeDB(deps),
        assembleResponse,
      ],
    }, deps);

    return handler.run(ctx);
  };
}
