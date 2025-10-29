import { SuccessResponse } from "../../../default-schemas.ts";
import { Context, Status } from "@oak/oak";
import { parseAndValidateRequestFactory } from "../../../utils/parse-request-payload.ts";
import { Transaction } from "stellar-sdk";
import { ContextWithParsedPayload } from "../../../utils/parse-request-payload.ts";
import {
  PostAuthPayload,
  postAuthSchema,
  PostAuthResPayload,
} from "./post.schema.ts";
import { Pipeline, Transformer } from "@fifo/convee";
import { VERIFY_CHALLENGE_PROCESS } from "../../../../services/auth/challenge/verify-challenge.process.ts";
import { COMPARE_CHALLENGE_PROCESS } from "../../../../services/auth/challenge/compare-challenge.process.ts";
import { UPDATE_CHALLENGE_SESSION } from "../../../../services/auth/challenge/update-challenge-session.process.ts";
import { UPDATE_CHALLENGE_DB } from "../../../../services/auth/challenge/update-challenge-db.process.ts";
import { NETWORK_CONFIG } from "../../../../config/env.ts";
import generateJwt from "../../../../services/auth/generate-jwt.ts";
import { processErrorResponsePluginFactory } from "../../../utils/plugins/process-error-response.ts";
import { appendSchemaToContextFactory } from "../../../utils/append-schema-to-context.ts";
import { ContextWith } from "../../../types.ts";
import { setApiResponse } from "../../../utils/set-api-response.ts";

// Additional Transformer to provide a new JWT for the account
const GET_JWT_FOR_USER = async (
  item: ContextWithParsedPayload<PostAuthPayload>
): Promise<ContextWith<string, "jwt">> => {
  const signedPayload = item.payload.signedChallenge;
  const tx = new Transaction(signedPayload, NETWORK_CONFIG.networkPassphrase);
  const hash = tx.hash().toString("hex");
  const clientAccount = tx.operations[0].source;
  if (!clientAccount) {
    throw new Error("Missing account in challenge operation");
  }

  const jwt = await generateJwt(clientAccount, hash);

  return {
    ctx: item.ctx,
    jwt,
  };
};

const appendSchema = appendSchemaToContextFactory(postAuthSchema);
const parse = parseAndValidateRequestFactory<typeof postAuthSchema>();
const setSuccessResponse = async (input: ContextWith<string, "jwt">) => {
  return {
    ctx: input.ctx,
    response: {
      status: Status.OK,
      message: "Auth challenge successfully created",
      data: {
        jwt: input.jwt,
      },
    } as PostAuthResPayload,
  };
};

export const postAuthEndpoint = (ctx: Context) => {
  const postAuthPipeline = Pipeline.create(
    [
      appendSchema,
      parse,
      VERIFY_CHALLENGE_PROCESS,
      COMPARE_CHALLENGE_PROCESS,
      UPDATE_CHALLENGE_SESSION,
      UPDATE_CHALLENGE_DB,
      GET_JWT_FOR_USER,
      setSuccessResponse,
      setApiResponse,
    ],
    {
      name: "PostAuthPipeline",
    }
  );
  const errorPlugin = processErrorResponsePluginFactory(ctx);

  postAuthPipeline.addPlugin(errorPlugin, postAuthPipeline.name);

  return postAuthPipeline.run(ctx);
};
