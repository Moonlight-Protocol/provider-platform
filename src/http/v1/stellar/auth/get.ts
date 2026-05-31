import { z } from "zod";
import { regex } from "@colibri/core";
import { type Context, Status } from "@oak/oak";
import { P_CreateChallengeDB } from "@/core/service/auth/challenge/store/create-challenge-db.ts";
import { P_CreateChallengeMemory } from "@/core/service/auth/challenge/store/create-challenge-memory.ts";
import { P_CreateChallenge } from "@/core/service/auth/challenge/create/create-challenge.ts";
import { PIPE_GetEndpoint } from "@/http/pipelines/get-endpoint.ts";
import type { GetEndpointOutput } from "@/http/pipelines/types.ts";
import type { ChallengeData } from "@/core/service/auth/challenge/types.ts";
import type { Logger } from "@/utils/logger/index.ts";

export const requestSchema = z.object({
  account: z.string().regex(regex.ed25519PublicKey),
});

export const responseSchema = z.object({
  hash: z.string(),
  challenge: z.string(),
});

export function handleGetAuth(
  deps: { log: Logger },
): (ctx: Context) => Promise<unknown> {
  const log = deps.log.scope("getAuth");

  const assembleResponse = (
    input: ChallengeData,
  ): GetEndpointOutput<typeof responseSchema> => {
    log.event("auth challenge successfully created");

    return {
      ctx: input.ctx,
      status: Status.OK,
      message: "Auth challenge successfully created",
      data: {
        hash: input.challengeData.txHash,
        challenge: input.challengeData.xdr,
      },
    };
  };

  return (ctx) => {
    log.info("getAuth");
    const handler = PIPE_GetEndpoint({
      name: "GetAuthEndpointPipeline",
      requestSchema: requestSchema,
      responseSchema: responseSchema,
      steps: [
        P_CreateChallenge(deps),
        P_CreateChallengeDB(deps),
        P_CreateChallengeMemory(deps),
        assembleResponse,
      ],
    }, deps);

    return handler.run(ctx);
  };
}
