import {
  type ConveeError,
  type MetadataHelper,
  type Modifier,
  Plugin,
  type Transformer,
} from "@fifo/convee";
import type { Context } from "@oak/oak";
import type { Logger } from "@/utils/logger/index.ts";
import * as E from "@/http/plugins/error.ts";
import { PIPE_APIError } from "@/http/pipelines/error-pipeline.ts";

export const PLG_ProcessErrorResponse = (deps: { log: Logger }) => {
  const log = deps.log.scope("errorPlugin");

  const processInput: Modifier<Context> = (
    input: Context,
    metadataHelper?: MetadataHelper,
  ): Context => {
    if (metadataHelper) metadataHelper.add("input-context", input);
    return input;
  };

  const processError: Transformer<
    ConveeError<Error>,
    ConveeError<Error> | Context
  > = async (
    error: ConveeError<Error>,
    metadataHelper?: MetadataHelper,
  ): Promise<ConveeError<Error> | Context> => {
    log.error(error, "plugin captured an error");

    const ctx = metadataHelper!.get("input-context") as Context;

    const errorPipeline = PIPE_APIError(ctx, deps);

    try {
      return await errorPipeline.run(error);
    } catch (e) {
      throw new E.PROCESSING_ERROR_RESPONSE_FAILED(e);
    }
  };

  return Plugin.create({
    name: "processErrorResponsePlugin",
    processInput,
    processError,
  });
};
