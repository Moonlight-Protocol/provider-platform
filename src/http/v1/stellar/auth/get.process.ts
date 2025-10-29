import { Status } from "@oak/oak";

import { Pipeline } from "@fifo/convee";
import { parseAndValidateQueryFactory } from "../../../utils/parse-request-query.ts";
import { type GetAuthResPayload, getAuthSchema } from "./get.schema.ts";
import { CREATE_CHALLENGE_DB } from "../../../../services/auth/challenge/create-challenge-db.process.ts";
import { CREATE_CHALLENGE_MEMORY } from "../../../../services/auth/challenge/create-challenge-memory.process.ts";
import {
  CREATE_CHALLENGE_PROCESS,
  type CreateChallengeOutput,
} from "../../../../services/auth/challenge/create-challenge.process.ts";
import type { Context } from "@oak/oak";
import { appendSchemaToContextFactory } from "../../../utils/append-schema-to-context.ts";
import { processErrorResponsePluginFactory } from "../../../utils/plugins/process-error-response.ts";
import { setApiResponse } from "../../../utils/set-api-response.ts";
import { db } from "../../../../infra/config/config.ts";

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

  db.users
    .findMany(["GDS3SZFBA4KYFUNFG4VPBAOV6B4IF2FENNSWTBKXHH4ZRRK26TMYWQ3V"])
    .then((users) => {
      console.log(users);
    });
  return getAuthPipeline.run(ctx);
};
