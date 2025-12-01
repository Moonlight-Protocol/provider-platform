import { ProcessEngine } from "@fifo/convee";
import { type Context, Status } from "@oak/oak";

import type { SuccessResponse } from "../schema/default.schema.ts";
import { LOG } from "../../logger/index.ts";
import type { SuccessResponseInput } from "./types.ts";

const setSuccessResponseProcess = async <DATA>(
  input: SuccessResponseInput<DATA>
): Promise<Context> => {
  const { ctx, data, status, message } = input;

  LOG.trace("Setting success response");
  LOG.debug(`Has data to append to response : ${!!data}`);

  ctx.response.status = Status.OK;

  ctx.response.body = {
    status,
    message,
    ...data,
  } as SuccessResponse<DATA>;

  LOG.debug(`Response body set with status ${ctx.response.status}`);
  return await ctx;
};

const PROCESS_NAME = "setSuccessResponse" as const;

const P_SetSuccessResponse = <DATA>() =>
  ProcessEngine.create<
    SuccessResponseInput<DATA>,
    Context,
    Error,
    typeof PROCESS_NAME
  >(setSuccessResponseProcess, {
    name: PROCESS_NAME,
  });

export { P_SetSuccessResponse };
