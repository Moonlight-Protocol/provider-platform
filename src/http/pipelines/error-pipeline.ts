import { Pipeline } from "@fifo/convee";
import type { Context } from "@oak/oak";
import { P_SetErrorResponse } from "@/http/processes/set-api-response.ts";
import { P_ErrorToApiResponse } from "@/http/processes/error-to-api-response.ts";

export const PIPE_APIError = (ctx: Context) => {
  return Pipeline.create([P_ErrorToApiResponse(), P_SetErrorResponse(ctx)], {
    name: "APIErrorProcessingPipeline",
  });
};
