import type { Context } from "@oak/oak";
import { ProcessEngine } from "@fifo/convee";
import type { MetadataHelper } from "@fifo/convee";
import type { ErrorResponse } from "@/http/default-schemas.ts";
import type { Logger } from "@/utils/logger/index.ts";

const PROCESS_NAME = "SetErrorResponse" as const;

const P_SetErrorResponse = (ctx: Context, deps: { log: Logger }) => {
  const log = deps.log.scope("setApiResponse");

  const setApiResponse = (
    response: ErrorResponse,
    _metadataHelper?: MetadataHelper,
  ): Context => {
    log.debug("status", response.status);
    log.event("setting API response on context");
    ctx.response.status = response.status;
    ctx.response.body = response;
    return ctx;
  };

  return ProcessEngine.create<
    ErrorResponse,
    Context,
    Error,
    typeof PROCESS_NAME
  >(setApiResponse, {
    name: PROCESS_NAME,
  });
};

export { P_SetErrorResponse };
