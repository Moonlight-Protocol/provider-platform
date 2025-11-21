import type { Context } from "@oak/oak";
import {
  type infer as ZodInfer,
  ZodObject,
  type ZodSchema,
} from "zod";
import { safeStringify } from "../../utils/parse/safeStringify.ts";
import type { MetadataHelper } from "@fifo/convee";

// Context + Schema input type
export type ContextWithSchema<T extends ZodSchema> = {
  ctx: Context;
  schema: T;
};

export type ContextWithParsedQuery<SchemaType> = {
  ctx: Context;
  query: SchemaType;
};

// Factory that returns a Transformer for parsing URL query parameters
export const parseAndValidateQueryFactory = <T extends ZodSchema>() => {
  return async (
    item: ContextWithSchema<T>,
    _metadataHelper?: MetadataHelper,
  ): Promise<ContextWithParsedQuery<ZodInfer<T>>> => {
    const { ctx, schema } = item;

    try {
      const queryPayload = Object.fromEntries(
        ctx.request.url.searchParams.entries(),
      );
      const validatedPayload = schema.parse(queryPayload);
      return { ctx, query: validatedPayload };
    } catch (error) {
      const shape = schema instanceof ZodObject
        ? schema.shape
        : "unknown shape";
      throw new Error(
        `Invalid query parameters: ${error} \n The correct format is: ${
          safeStringify(
            shape,
          )
        }`,
      );
    }
  };
};
