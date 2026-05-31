import { Pipeline } from "@fifo/convee";
import type { Context } from "@oak/oak";
import type { Logger } from "@/utils/logger/index.ts";
import { P_SetErrorResponse } from "@/http/processes/set-api-response.ts";
import { P_ErrorToApiResponse } from "@/http/processes/error-to-api-response.ts";

export const PIPE_APIError = (ctx: Context, deps: { log: Logger }) => {
  return Pipeline.create(
    [P_ErrorToApiResponse(), P_SetErrorResponse(ctx, deps)],
    {
      name: "APIErrorProcessingPipeline",
    },
  );
};
