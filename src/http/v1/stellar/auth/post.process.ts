import { type Context, Status } from "@oak/oak";
import { parseAndValidateRequestFactory } from "@/http/utils/parse-request-payload.ts";
import {
  postAuthSchema,
  type PostAuthResPayload,
} from "@/http/v1/stellar/auth/post.schema.ts";
import { Pipeline } from "@fifo/convee";
import { VERIFY_CHALLENGE_PROCESS } from "@/core/service/auth/challenge/verify-challenge.process.ts";
import { COMPARE_CHALLENGE_PROCESS } from "@/core/service/auth/challenge/compare-challenge.process.ts";
import { UPDATE_CHALLENGE_SESSION } from "@/core/service/auth/challenge/update-challenge-session.process.ts";
import { UPDATE_CHALLENGE_DB } from "@/core/service/auth/challenge/update-challenge-db.process.ts";
import { GENERATE_CHALLENGE_JWT_PROCESS } from "@/core/service/auth/challenge/generate-challenge-jwt.process.ts";
import { processErrorResponsePluginFactory } from "@/http/utils/plugins/process-error-response.ts";
import { appendSchemaToContextFactory } from "@/http/utils/append-schema-to-context.ts";
import type { ContextWith } from "@/http/types.ts";
import { setApiResponse } from "@/http/utils/set-api-response.ts";

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
      GENERATE_CHALLENGE_JWT_PROCESS,
      UPDATE_CHALLENGE_SESSION,
      UPDATE_CHALLENGE_DB,
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
