import type { ZodSchema, z } from "zod";
import type {
  ContextWithParsedBody,
  ContextWithParsedQuery,
  SuccessResponseInput,
} from "@/http/processes/types.ts";

type DefaultEndpointOutput<ResponseSchema extends ZodSchema> =
  SuccessResponseInput<z.infer<ResponseSchema>>;
export type GetEndpointInput<RequestSchema extends ZodSchema> =
  ContextWithParsedQuery<z.infer<RequestSchema>>;

export type GetEndpointOutput<ResponseSchema extends ZodSchema> =
  DefaultEndpointOutput<ResponseSchema>;

export type PostEndpointInput<RequestSchema extends ZodSchema> =
  ContextWithParsedBody<z.infer<RequestSchema>>;

export type PostEndpointOutput<ResponseSchema extends ZodSchema> =
  DefaultEndpointOutput<ResponseSchema>;
