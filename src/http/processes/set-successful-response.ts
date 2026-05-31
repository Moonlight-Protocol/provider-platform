import { ProcessEngine } from "@fifo/convee";
import { type Context, Status } from "@oak/oak";
import type { infer as ZodInfer, ZodSchema } from "zod";
import type { SuccessResponseInput } from "@/http/processes/types.ts";
import type { Logger } from "@/utils/logger/index.ts";
import * as E from "@/http/processes/error.ts";

const PROCESS_NAME = "setSuccessResponse" as const;

const P_SetSuccessResponse = <S extends ZodSchema>(
  schema: S,
  deps: { log: Logger },
) => {
  const log = deps.log.scope("setSuccessResponse");

  const setSuccessResponseProcess = (
    input: SuccessResponseInput<ZodInfer<S>>,
  ): Context => {
    const { ctx, data, status, message } = input;

    log.debug("hasData", !!data);
    log.event("setting success response");

    try {
      ctx.response.status = Status.OK;

      const validatedData = schema.parse(data);

      ctx.response.body = {
        status,
        message,
        data: validatedData,
      } as SuccessResponseInput<ZodInfer<S>>;

      log.debug("status", ctx.response.status);
      return ctx;
    } catch (error) {
      throw new E.FAILED_TO_SET_SUCCESS_RESPONSE(error);
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
