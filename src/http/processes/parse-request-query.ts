import { ProcessEngine } from "@fifo/convee";
import type { Context } from "@oak/oak";
import { type infer as ZodInfer, ZodObject, type ZodSchema } from "zod";
import { LOG } from "@/config/logger.ts";
import { safeStringify } from "@/utils/parse/safeStringify.ts";
import type { ContextWithParsedQuery } from "@/http/processes/types.ts";

const PROCESS_NAME = "ParseRequestQuery" as const;

/**
 *
 * Factory Process that parses and validates URL query parameters
 *
 * @param schema - Zod schema to validate the query parameters against
 * @returns A Process that takes a Context and returns a ContextWithParsedQuery
 * @throws Error if the query parameters are invalid
 *
 * @example
 * ```ts
 * import { P_ParseRequestQuery } from "@/http/processes/parse-request-query.ts";
 * import { ZodSchema, z } from "zod";
 *
 * const querySchema = z.object({
 *   search: z.string(),
 *   page: z.number().optional(),
 * });
 *
 * const parseQueryProcess = P_ParseRequestQuery(querySchema);
 * ```
 *
 */
const P_ParseRequestQuery = <S extends ZodSchema>(schema: S) => {
  const parseRequestProcess = (
    ctx: Context
  ): ContextWithParsedQuery<ZodInfer<S>> => {
    LOG.trace("Parsing request body");

    try {
      const queryPayload = Object.fromEntries(
        ctx.request.url.searchParams.entries()
      );
      const validatedPayload = schema.parse(queryPayload);
      return { ctx, query: validatedPayload };
    } catch (error) {
      const shape =
        schema instanceof ZodObject ? schema.shape : "unknown shape";
      throw new Error(
        `Invalid query parameters: ${error} \n The correct format is: ${safeStringify(
          shape
        )}`
      );
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
