import { ProcessEngine } from "@fifo/convee";
import { type Context, Status } from "@oak/oak";
import type { WithContext } from "../types.ts";
import type { ErrorResponse } from "../schema/default.schema.ts";
import { LOG } from "../../logger/index.ts";

type ErrorObj = { error: Error };

const setErrorResponseProcess = async (
  input: WithContext<ErrorObj>
): Promise<Context> => {
  const { ctx, error } = input;

  LOG.trace("Setting error response");
  ctx.response.status = Status.InternalServerError;

  ctx.response.body = {
    status: Status.InternalServerError,
    message: error.message,
    data: {
      error: error.stack,
    },
  } as ErrorResponse;

  LOG.debug(`Response body set with status ${ctx.response.status}`);
  return await ctx;
};

const PROCESS_NAME = "setErrorResponse" as const;

const P_SetErrorResponse = () =>
  ProcessEngine.create<
    WithContext<ErrorObj>,
    Context,
    Error,
    typeof PROCESS_NAME
  >(setErrorResponseProcess, {
    name: PROCESS_NAME,
  });

export { P_SetErrorResponse };
