import { Context } from "@oak/oak";
import { Transformer } from "@fifo/convee";
import { MetadataHelper } from "@fifo/convee";
import { ApiResponse } from "../default-schemas.ts";

type Input = {
  ctx: Context;
  response: ApiResponse;
};

export const setApiResponse: Transformer<Input, Context> = async (
  { ctx, response }: Input,
  _metadataHelper?: MetadataHelper
): Promise<Context> => {
  ctx.response.status = response.status;
  ctx.response.body = response;
  return ctx;
};
