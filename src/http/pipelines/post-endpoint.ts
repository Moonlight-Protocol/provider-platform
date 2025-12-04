import type { ZodSchema } from "zod";
import { Pipeline, type PipelineStep, type PipelineSteps } from "@fifo/convee";
import { P_ParseRequestBody } from "@/http/processes/parse-request-body.ts";
import { P_SetSuccessResponse } from "@/http/processes/set-successful-response.ts";
import type {
  PostEndpointInput,
  PostEndpointOutput,
} from "@/http/pipelines/types.ts";
import { PLG_ProcessErrorResponse } from "@/http/plugins/process-error-response.ts";

export const PIPE_PostEndpoint = <
  Req extends ZodSchema,
  Res extends ZodSchema,
  // deno-lint-ignore no-explicit-any
  Steps extends [PipelineStep<any, any, any>, ...PipelineStep<any, any, any>[]]
>({
  name = "POST_EndpointPipeline",
  requestSchema,
  responseSchema,
  steps,
}: {
  steps: [...Steps] &
    PipelineSteps<PostEndpointInput<Req>, PostEndpointOutput<Res>, Steps>;
  name?: string;
  requestSchema: Req;
  responseSchema: Res;
}) => {
  const pipe = Pipeline.create(
    [
      P_ParseRequestBody(requestSchema),
      ...steps,
      P_SetSuccessResponse(responseSchema),
    ],
    { name }
  );

  pipe.addPlugin(PLG_ProcessErrorResponse(), name);

  return pipe;
};
