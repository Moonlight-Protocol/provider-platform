import { ProcessEngine } from "@fifo/convee";
import type { Context } from "@oak/oak";
import { type infer as ZodInfer, ZodError, type ZodSchema } from "zod";
import type { ContextWithParsedQuery } from "@/http/processes/types.ts";
import type { Logger } from "@/utils/logger/index.ts";
import * as E from "@/http/processes/error.ts";

const PROCESS_NAME = "ParseRequestQuery" as const;

const P_ParseRequestQuery = <S extends ZodSchema>(
  schema: S,
  deps: { log: Logger },
) => {
  const log = deps.log.scope("parseRequestQuery");

  const parseRequestProcess = (
    ctx: Context,
  ): ContextWithParsedQuery<ZodInfer<S>> => {
    log.event("parsing request query");

    try {
      const queryPayload = Object.fromEntries(
        ctx.request.url.searchParams.entries(),
      );
      const validatedPayload = schema.parse(queryPayload);
      return { ctx, query: validatedPayload };
    } catch (error) {
      if (error instanceof ZodError) {
        throw new E.INVALID_QUERY_PARAMS(error, error.issues);
      }

      throw new E.FAILED_TO_PARSE_QUERY_PARAMS(error);
    }
  };

  return ProcessEngine.create<
    Context,
    ContextWithParsedQuery<ZodInfer<S>>,
    Error,
    typeof PROCESS_NAME
  >(parseRequestProcess, {
    name: PROCESS_NAME,
  });
};

export { P_ParseRequestQuery };
