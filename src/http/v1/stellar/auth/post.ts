import { z } from "zod";
import { type Context, Status } from "@oak/oak";
import { P_VerifyChallenge } from "@/core/service/auth/challenge/verify-challenge.ts";
import { P_UpdateChallengeSession } from "@/core/service/auth/challenge/update-challenge-session.ts";
import { P_UpdateChallengeDB } from "@/core/service/auth/challenge/update-challenge-db.ts";
import { P_GenerateChallengeJWT } from "@/core/service/auth/challenge/generate-challenge-jwt.ts";
import type { PostEndpointOutput } from "@/http/pipelines/types.ts";
import { PIPE_PostEndpoint } from "@/http/pipelines/post-endpoint.ts";
import { P_CompareChallenge } from "@/core/service/auth/challenge/compare-challenge.ts";
import type { ContextWithJWT } from "@/core/service/auth/challenge/types.ts";

export const requestSchema = z.object({
  signedChallenge: z.string(),
});

export const responseSchema = z.object({
  jwt: z.string(),
});

const assembleResponse = (
  input: ContextWithJWT
): PostEndpointOutput<typeof responseSchema> => {
  return {
    ctx: input.ctx,
    status: Status.OK,
    message: "Auth challenge successfully created",
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
