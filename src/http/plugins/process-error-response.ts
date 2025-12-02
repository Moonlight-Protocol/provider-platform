import {
  type ConveeError,
  Pipeline,
  Plugin,
  type Transformer,
  type Modifier,
  type MetadataHelper,
} from "@fifo/convee";
import type { Context } from "@oak/oak";
import { LOG } from "@/config/logger.ts";
import { P_SetErrorResponse } from "@/http/processes/set-api-response.ts";
import { P_ErrorToApiResponse } from "@/http/processes/error-to-api-response.ts";

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
    LOG.debug("Plugin captured an error: ", error.message);

    const ctx = metadataHelper!.get("input-context") as Context;

    const errorPipeline = Pipeline.create(
      [P_ErrorToApiResponse(), P_SetErrorResponse(ctx)],
      { name: "APIErrorProcessingPipeline" }
    );
    const result = await errorPipeline.run(error).catch((e) => {
      const errorMessage = `Failed to process error response: ${e.message}`;
      LOG.fatal(errorMessage);
      throw new Error(errorMessage);
    });

    return result;
  };

  return Plugin.create({
    name: "processErrorResponsePlugin",
    processInput,
    processError,
  });
};
