import { Pipeline } from "@fifo/convee";
import type { ZodSchema, z } from "zod";
import { appendSchemaToContextFactory } from "@/http/utils/append-schema-to-context.ts";
import { parseAndValidateQueryFactory } from "@/http/utils/parse-request-query.ts";
import type { ContextWithParsedQuery } from "@/http/utils/parse-request-query.ts";

export const PIPE_GetEndpoint = <S extends ZodSchema>({
  name = "GET_EndpointPipeline",
  handlerFn,
  requestSchema,
}: {
  name: string;
  handlerFn: (
    input: ContextWithParsedQuery<z.infer<typeof requestSchema>>
  ) => Promise<HandlerOutput<ResData>>;
  requestSchema: S;
}) => {
  const appendRequestSchema = appendSchemaToContextFactory(requestSchema);
  const parseRequestData = parseAndValidateQueryFactory<typeof requestSchema>();

  return Pipeline.create(
    [appendRequestSchema, parseRequestData, handlerFn],
    //   P_ParseRequest<ReqData>(), handlerFn, P_SetSuccessResponse<ResData>()],
    { name }
  );
};
