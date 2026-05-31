import { ProcessEngine } from "@fifo/convee";
import type { Context } from "@oak/oak";
import { type infer as ZodInfer, ZodError, type ZodSchema } from "zod";
import type { ContextWithParsedBody } from "@/http/processes/types.ts";
import type { Logger } from "@/utils/logger/index.ts";
import * as E from "@/http/processes/error.ts";

const PROCESS_NAME = "ParseRequestBody" as const;

const P_ParseRequestBody = <S extends ZodSchema>(
  schema: S,
  deps: { log: Logger },
) => {
  const log = deps.log.scope("parseRequestBody");

  const parseRequestProcess = async (
    ctx: Context,
  ): Promise<ContextWithParsedBody<ZodInfer<S>>> => {
    log.event("parsing request body");

    try {
      const bodyPayload = await ctx.request.body.json();
      const validatedPayload = schema.parse(bodyPayload);

      return { ctx, body: validatedPayload };
    } catch (error) {
      if (error instanceof ZodError) {
        throw new E.INVALID_PAYLOAD(error, error.issues);
      }

      throw new E.FAILED_TO_PARSE_BODY(error);
    }
  };

  return ProcessEngine.create<
    Context,
    ContextWithParsedBody<ZodInfer<S>>,
    Error,
    typeof PROCESS_NAME
  >(parseRequestProcess, {
    name: PROCESS_NAME,
  });
};

export { P_ParseRequestBody };
