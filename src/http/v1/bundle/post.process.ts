import { SuccessResponse } from "../../default-schemas.ts";
import { Context, Status } from "@oak/oak";

import {
  PostBundlePayload,
  PostBundleResPayload,
  postBundleSchema,
} from "./post.schema.ts";

import {
  ContextWithParsedPayload,
  parseAndValidateRequestFactory,
} from "../../utils/parse-request-payload.ts";
import { processErrorResponsePluginFactory } from "../../utils/plugins/process-error-response.ts";
import { appendSchemaToContextFactory } from "../../utils/append-schema-to-context.ts";
import { ContextWith } from "../../types.ts";
import { Pipeline } from "@fifo/convee";
import { setApiResponse } from "../../utils/set-api-response.ts";
import { PROCESS_NEW_BUNDLE } from "../../../core/bundle/processes/process-new-bundle.ts";

const appendSchema = appendSchemaToContextFactory(postBundleSchema);
const parse = parseAndValidateRequestFactory<typeof postBundleSchema>();

const setSuccessResponse = async (
  input: ContextWith<string, "transactionHash"> &
    ContextWith<string, "bundleHash">
) => {
  return {
    ctx: input.ctx,
    response: {
      status: Status.OK,
      message: "Bundle successfully processed",
      data: {
        transactionHash: input.transactionHash,
        bundleHash: input.bundleHash,
      },
    } as PostBundleResPayload,
  };
};

export const postBundleEndpoint = (ctx: Context) => {
  const postBundlePipeline = Pipeline.create(
    [
      appendSchema,
      parse,
      PROCESS_NEW_BUNDLE,
      setSuccessResponse,
      setApiResponse,
    ],
    {
      name: "PostBundlePipeline",
    }
  );

  const errorPlugin = processErrorResponsePluginFactory(ctx);

  postBundlePipeline.addPlugin(errorPlugin, postBundlePipeline.name);

  return postBundlePipeline.run(ctx);
};
