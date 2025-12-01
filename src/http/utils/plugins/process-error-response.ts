import {
  type ConveeError,
  Pipeline,
  Plugin,
  type Transformer,
} from "@fifo/convee";
import { appendCtxResponseFactory } from "../append-ctx-response.ts";
import { setApiResponse } from "../set-api-response.ts";
import type { Context } from "@oak/oak";
import { ERROR_TO_API_RESPONSE } from "../error-to-api-response.ts";
import { LOG } from "@/config/logger.ts";

export const processErrorResponsePluginFactory = (ctx: Context) => {
  const processError: Transformer<
    ConveeError<Error>,
    ConveeError<Error> | Context
  > = async (
    error: ConveeError<Error>
  ): Promise<ConveeError<Error> | Context> => {
    LOG.error("Plugin captured an error: ", error.message);
    const errorPipeline = Pipeline.create(
      [ERROR_TO_API_RESPONSE, appendCtxResponseFactory(ctx), setApiResponse],
      { name: "APIErrorProcessingPipeline" }
    );
    const result = await errorPipeline.run(error).catch((e) => {
      throw new Error(
        `Unexpected Error when processing error response: ${e.message}`
      );
    });

    return result;
  };

  return Plugin.create({
    name: "processErrorResponsePlugin",
    processError,
  });
};
