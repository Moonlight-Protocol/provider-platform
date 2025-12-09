import { ProcessEngine } from "@fifo/convee";
import type { Context } from "@oak/oak";
import { ZodError, type infer as ZodInfer, type ZodSchema } from "zod";
import { LOG } from "@/config/logger.ts";
import type { ContextWithParsedBody } from "@/http/processes/types.ts";
import * as E from "@/http/processes/error.ts";
import { logAndThrow } from "@/utils/error/log-and-throw.ts";

const PROCESS_NAME = "ParseRequestBody" as const;

/**
 *
 * Factory Process that parses and validates the request body
 *
 * @param schema - Zod schema to validate the request body against
 * @returns A Process that takes a Context and returns a ContextWithParsedBody
 * @throws Error if the request body is invalid
 *
 * @example
 * ```ts
 * import { P_ParseRequestBody } from "@/http/processes/parse-request-query.ts";
 * import { ZodSchema, z } from "zod";
 *
 * const bodySchema = z.object({
 *   search: z.string(),
 *   page: z.number().optional(),
 * });
 *
 * const parseBodyProcess = P_ParseRequestBody(bodySchema);
 * ```
 *
 */
const P_ParseRequestBody = <S extends ZodSchema>(schema: S) => {
  const parseRequestProcess = async (
    ctx: Context
  ): Promise<ContextWithParsedBody<ZodInfer<S>>> => {
    LOG.trace("Parsing request body");

    try {
      const bodyPayload = await ctx.request.body.json();
      const validatedPayload = schema.parse(bodyPayload);

      return { ctx, body: validatedPayload };
    } catch (error) {
      if (error instanceof ZodError) {
        logAndThrow(new E.INVALID_PAYLOAD(error, error.issues));
      }

      logAndThrow(new E.FAILED_TO_PARSE_BODY(error));
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
