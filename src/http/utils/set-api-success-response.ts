import type { Context } from "@oak/oak";
import type { ApiResponse } from "../default-schemas.ts";
import { Status } from "@oak/oak";

type Input = {
  ctx: Context;
  response: ApiResponse;
};

// export const setApiResponse: Transformer<Input, Context> = async (
//   { ctx, response }: Input,
//   _metadataHelper?: MetadataHelper
// ): Promise<Context> => {
//   ctx.response.status = response.status;
//   ctx.response.body = response;
//   return ctx;
// };

interface ApiSuccessResponseOptions {
  status?: Status;
  message?: string;
  data?: any;
}

// Use the interface in the function signature with a default empty object.
export const setApiSuccessResponseFactory = <I>({
  status = Status.OK,
  message = "Success",
  data,
}: ApiSuccessResponseOptions = {}) => {
  return async (input: I) => {
    return {
      status,
      message,
      data,
    };
  };
};
