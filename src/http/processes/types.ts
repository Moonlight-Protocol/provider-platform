import type { Context } from "@oak/oak";

import type { BaseSuccessResponse } from "../default-schemas.ts";

export type SuccessResponseInput<D> = BaseSuccessResponse & {
  ctx: Context;
  data?: D;
};

export type ContextWithParsedQuery<SchemaType> = {
  ctx: Context;
  query: SchemaType;
};
