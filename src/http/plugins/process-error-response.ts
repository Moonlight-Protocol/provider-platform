import {
  type ConveeError,
  Plugin,
  type Transformer,
  type Modifier,
  type MetadataHelper,
} from "@fifo/convee";
import type { Context } from "@oak/oak";
import { LOG } from "@/config/logger.ts";
import * as E from "@/http/plugins/error.ts";
import { logAndThrow } from "@/utils/error/log-and-throw.ts";
import { PIPE_APIError } from "@/http/pipelines/error-pipeline.ts";

export const PLG_ProcessErrorResponse = () => {
  const processInput: Modifier<Context> = (
    input: Context,
    metadataHelper?: MetadataHelper
  ): Context => {
    LOG.trace("Storing input context for error plugin processing");
    if (metadataHelper) metadataHelper.add("input-context", input);
    return input;
  };

  const processError: Transformer<
    ConveeError<Error>,
    ConveeError<Error> | Context
  > = async (
    error: ConveeError<Error>,
    metadataHelper?: MetadataHelper
  ): Promise<ConveeError<Error> | Context> => {
    LOG.error("Plugin captured an error: ", error.message);

    const ctx = metadataHelper!.get("input-context") as Context;

    const errorPipeline = PIPE_APIError(ctx);

    try {
      return await errorPipeline.run(error);
    } catch (e) {
      logAndThrow(new E.PROCESSING_ERROR_RESPONSE_FAILED(e));
    }
  };

  return Plugin.create({
    name: "processErrorResponsePlugin",
    processInput,
    processError,
  });
};
