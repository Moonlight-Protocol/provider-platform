import { Pipeline } from "@fifo/convee";
import type { ZodSchema, z } from "zod";
import type { ContextWithParsedQuery } from "@/http/utils/parse-request-query.ts";
import { P_ParseRequestQuery } from "../processes/parse-request-query.ts";
import { P_SetSuccessResponse } from "../processes/set-successfull-response.ts";
import type { Context } from "@oak/oak";

export const PIPE_GetEndpoint = <Req extends ZodSchema, Res extends ZodSchema>({
  name = "GET_EndpointPipeline",
  handlerFn,
  requestSchema,
  responseSchema,
}: {
  name: string;
  handlerFn: (
    input: ContextWithParsedQuery<z.infer<typeof requestSchema>>
  ) => Promise<Context>;
  requestSchema: Req;
  responseSchema: Res;
}) => {
  return Pipeline.create(
    [
      P_ParseRequestQuery(requestSchema),
      handlerFn,
      P_SetSuccessResponse(responseSchema),
    ],
    //   P_ParseRequest<ReqData>(), handlerFn, P_SetSuccessResponse<ResData>()],
    { name }
  );
};
