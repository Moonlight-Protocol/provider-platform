import { ProcessEngine } from "@fifo/convee";
import type { Context } from "@oak/oak";
import type { RequestData, WithContext } from "../types.ts";
import { LOG } from "../../logger/index.ts";

const parseRequestProcess = async <DATA>(
  ctx: Context
): Promise<WithContext<RequestData<DATA>>> => {
  LOG.trace("Parsing request body");

  if (!ctx.request.hasBody) {
    LOG.trace("No request body found");
    return { ctx } as WithContext<RequestData<DATA>>;
  }

  LOG.trace("Request body found, parsing JSON");
  const body = await ctx.request.body.json();
  return { ctx, data: body } as WithContext<RequestData<DATA>>;
};

const PROCESS_NAME = "ParseRequest" as const;

const P_ParseRequest = <DATA>() =>
  ProcessEngine.create<
    Context,
    WithContext<RequestData<DATA>>,
    Error,
    typeof PROCESS_NAME
  >(parseRequestProcess, {
    name: PROCESS_NAME,
  });

export { P_ParseRequest };
