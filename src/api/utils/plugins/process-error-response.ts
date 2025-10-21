import { ConveeError, MetadataHelper, Pipeline, Plugin } from "@fifo/convee";
import { appendCtxResponseFactory } from "../append-ctx-response.ts";
import { setApiResponse } from "../set-api-response.ts";
import { Context } from "@oak/oak";
import { ERROR_TO_API_RESPONSE } from "../error-to-api-response.ts";

export const processErrorResponsePluginFactory = (ctx: Context) =>
  Plugin.create(
    {
      processError: async (
        error: ConveeError<Error>,
        metadataHelper?: MetadataHelper,
      ): Promise<ConveeError<Error> | Context> => {
        console.log("Plugin captured an error: ", error.message);
        const errorPipeline = Pipeline.create([
          ERROR_TO_API_RESPONSE,
          appendCtxResponseFactory(ctx),
          setApiResponse,
        ]);
        const result = await errorPipeline.run(error);
        return result;
      },
    },
    { name: "processErrorResponsePlugin" },
  );
