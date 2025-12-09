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
import { LOG } from "@/config/logger.ts";

export const requestSchema = z.object({
  signedChallenge: z.string(),
});

export const responseSchema = z.object({
  jwt: z.string(),
});

const assembleResponse = (
  input: ContextWithJWT
): PostEndpointOutput<typeof responseSchema> => {
  const message = "Auth challenge verified successfully";

  LOG.info(message);

  return {
    ctx: input.ctx,
    status: Status.OK,
    message,
    data: {
      jwt: input.jwt,
    },
  };
};

export const postAuthHandler = (ctx: Context) => {
  const handler = PIPE_PostEndpoint({
    name: "PostAuthEndpointPipeline",
    requestSchema: requestSchema,
    responseSchema: responseSchema,
    steps: [
      P_VerifyChallenge,
      P_CompareChallenge,
      P_GenerateChallengeJWT,
      P_UpdateChallengeSession,
      P_UpdateChallengeDB,
      assembleResponse,
    ],
  });

  return handler.run(ctx);
};
