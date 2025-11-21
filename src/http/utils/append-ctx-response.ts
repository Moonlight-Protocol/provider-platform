import { Context } from "@oak/oak";
import { MetadataHelper, Transformer } from "@fifo/convee";
import { ApiResponse } from "../default-schemas.ts";

type Input = ApiResponse;
type Output = {
  ctx: Context;
  response: ApiResponse;
};

export const appendCtxResponseFactory = (
  ctx: Context
): Transformer<Input, Output> => {
  return async (
    response: Input,
    _metadataHelper?: MetadataHelper
  ): Promise<Output> => {
    return { ctx, response };
  };
};
