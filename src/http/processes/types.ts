import type { Context } from "@oak/oak";
import type { BaseSuccessResponse } from "@/http/default-schemas.ts";

export type SuccessResponseInput<D> = BaseSuccessResponse & {
  ctx: Context;
  data?: D;
};

export type ContextWithParsedQuery<SchemaType> = {
  ctx: Context;
  query: SchemaType;
};

export type ContextWithParsedBody<SchemaType> = {
  ctx: Context;
  body: SchemaType;
};
