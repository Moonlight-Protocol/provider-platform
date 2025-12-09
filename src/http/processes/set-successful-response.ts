import { ProcessEngine } from "@fifo/convee";
import { type Context, Status } from "@oak/oak";
import type { infer as ZodInfer, ZodSchema } from "zod";
import type { SuccessResponseInput } from "@/http/processes/types.ts";
import { LOG } from "@/config/logger.ts";
import * as E from "@/http/processes/error.ts";
import { logAndThrow } from "@/utils/error/log-and-throw.ts";

const PROCESS_NAME = "setSuccessResponse" as const;

const P_SetSuccessResponse = <S extends ZodSchema>(schema: S) => {
  const setSuccessResponseProcess = (
    input: SuccessResponseInput<ZodInfer<S>>
  ): Context => {
    const { ctx, data, status, message } = input;

    LOG.trace("Setting success response");
    LOG.debug(`Has data to append to response : ${!!data}`);

    try {
      ctx.response.status = Status.OK;

      const validatedData = schema.parse(data);

      ctx.response.body = {
        status,
        message,
        data: validatedData,
      } as SuccessResponseInput<ZodInfer<S>>;

      LOG.debug("Response body set with status:", ctx.response.status);
      return ctx;
    } catch (error) {
      logAndThrow(new E.FAILED_TO_SET_SUCCESS_RESPONSE(error));
    }
  };

  return ProcessEngine.create<
    SuccessResponseInput<ZodInfer<S>>,
    Context,
    Error,
    typeof PROCESS_NAME
  >(setSuccessResponseProcess, {
    name: PROCESS_NAME,
  });
};
export { P_SetSuccessResponse };
