import { Pipeline, type PipelineStep, type PipelineSteps } from "@fifo/convee";
import type { ZodSchema } from "zod";
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
  Steps extends [PipelineStep<any, any, any>, ...PipelineStep<any, any, any>[]]
>({
  name = "GET_EndpointPipeline",
  requestSchema,
  responseSchema,
  steps,
}: {
  steps: [...Steps] &
    PipelineSteps<GetEndpointInput<Req>, GetEndpointOutput<Res>, Steps>;
  name?: string;
  requestSchema: Req;
  responseSchema: Res;
}) => {
  const pipe = Pipeline.create(
    [
      P_ParseRequestQuery(requestSchema),
      ...steps,
      P_SetSuccessResponse(responseSchema),
    ],
    { name }
  );

  pipe.addPlugin(PLG_ProcessErrorResponse(), name);

  return pipe;
};
