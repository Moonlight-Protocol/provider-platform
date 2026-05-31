import { Pipeline, type PipelineStep, type PipelineSteps } from "@fifo/convee";
import type { ZodSchema } from "zod";
import type { Logger } from "@/utils/logger/index.ts";
import { P_ParseRequestQuery } from "@/http/processes/parse-request-query.ts";
import { P_SetSuccessResponse } from "@/http/processes/set-successful-response.ts";
import { PLG_ProcessErrorResponse } from "@/http/plugins/process-error-response.ts";
import type {
  GetEndpointInput,
  GetEndpointOutput,
} from "@/http/pipelines/types.ts";

export const PIPE_GetEndpoint = <
  Req extends ZodSchema,
  Res extends ZodSchema,
  // deno-lint-ignore no-explicit-any
  Steps extends [PipelineStep<any, any, any>, ...PipelineStep<any, any, any>[]],
>({
  name = "GET_EndpointPipeline",
  requestSchema,
  responseSchema,
  steps,
}: {
  steps:
    & [...Steps]
    & PipelineSteps<GetEndpointInput<Req>, GetEndpointOutput<Res>, Steps>;
  name?: string;
  requestSchema: Req;
  responseSchema: Res;
}, deps: { log: Logger }) => {
  const pipe = Pipeline.create(
    [
      P_ParseRequestQuery(requestSchema, deps),
      ...steps,
      P_SetSuccessResponse(responseSchema, deps),
    ],
    { name },
  );

  pipe.addPlugin(PLG_ProcessErrorResponse(deps), name);

  return pipe;
};
