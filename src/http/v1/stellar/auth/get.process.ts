import { Status } from "@oak/oak";

import { Pipeline } from "@fifo/convee";
import { parseAndValidateQueryFactory } from "@/http/utils/parse-request-query.ts";
import { type GetAuthResPayload, getAuthSchema } from "@/http/v1/stellar/auth/get.schema.ts";
import { CREATE_CHALLENGE_DB } from "@/core/service/auth/challenge/create-challenge-db.process.ts";
import { CREATE_CHALLENGE_MEMORY } from "@/core/service/auth/challenge/create-challenge-memory.process.ts";
import {
  CREATE_CHALLENGE_PROCESS,
  type CreateChallengeOutput,
} from "@/core/service/auth/challenge/create-challenge.process.ts";
import type { Context } from "@oak/oak";
import { appendSchemaToContextFactory } from "@/http/utils/append-schema-to-context.ts";
import { processErrorResponsePluginFactory } from "@/http/utils/plugins/process-error-response.ts";
import { setApiResponse } from "@/http/utils/set-api-response.ts";

const appendSchema = appendSchemaToContextFactory(getAuthSchema);
const parse = parseAndValidateQueryFactory<typeof getAuthSchema>();
const setSuccessResponse = async (input: CreateChallengeOutput) => {
  return await {
    ctx: input.ctx,
    response: {
      status: Status.OK,
      message: "Auth challenge successfully created",
      data: {
        hash: input.challengeData.txHash,
        challenge: input.challengeData.xdr,
      },
    } as GetAuthResPayload,
  };
};

export const getAuthEndpoint = (ctx: Context) => {
  const getAuthPipeline = Pipeline.create(
    [
      appendSchema,
      parse,
      CREATE_CHALLENGE_PROCESS,
      CREATE_CHALLENGE_DB,
      CREATE_CHALLENGE_MEMORY,
      setSuccessResponse,
      setApiResponse,
    ],
    {
      name: "CreateChallengePipeline",
    }
  );

  const errorPlugin = processErrorResponsePluginFactory(ctx);

  getAuthPipeline.addPlugin(errorPlugin, getAuthPipeline.name);

  return getAuthPipeline.run(ctx);
};
