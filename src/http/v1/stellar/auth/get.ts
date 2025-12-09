import { z } from "zod";
import { regex } from "@colibri/core";
import { Status, type Context } from "@oak/oak";
import { P_CreateChallengeDB } from "@/core/service/auth/challenge/store/create-challenge-db.ts";
import { P_CreateChallengeMemory } from "@/core/service/auth/challenge/store/create-challenge-memory.ts";
import { P_CreateChallenge } from "@/core/service/auth/challenge/create/create-challenge.ts";
import { PIPE_GetEndpoint } from "@/http/pipelines/get-endpoint.ts";
import type { GetEndpointOutput } from "@/http/pipelines/types.ts";
import type { ChallengeData } from "@/core/service/auth/challenge/types.ts";
import { LOG } from "@/config/logger.ts";

export const requestSchema = z.object({
  account: z.string().regex(regex.ed25519PublicKey),
});

export const responseSchema = z.object({
  hash: z.string(),
  challenge: z.string(),
});

const assembleResponse = (
  input: ChallengeData
): GetEndpointOutput<typeof responseSchema> => {
  const message = "Auth challenge successfully created";

  LOG.info(message);

  return {
    ctx: input.ctx,
    status: Status.OK,
    message,
    data: {
      hash: input.challengeData.txHash,
      challenge: input.challengeData.xdr,
    },
  };
};

export const getAuthHandler = (ctx: Context) => {
  const handler = PIPE_GetEndpoint({
    name: "GetAuthEndpointPipeline",
    requestSchema: requestSchema,
    responseSchema: responseSchema,
    steps: [
      P_CreateChallenge,
      P_CreateChallengeDB,
      P_CreateChallengeMemory,
      assembleResponse,
    ],
  });

  return handler.run(ctx);
};
