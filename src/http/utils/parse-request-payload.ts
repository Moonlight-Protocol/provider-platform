import type { Context } from "@oak/oak";
import {
  type infer as ZodInfer,
  ZodObject,
  type ZodSchema,
} from "zod";
import { safeStringify } from "@/utils/parse/safeStringify.ts";
import type { MetadataHelper } from "@fifo/convee";

// Context + Schema input type
export type ContextWithSchema<T extends ZodSchema> = {
  ctx: Context;
  schema: T;
};

export type ContextWithParsedPayload<SchemaType> = {
  ctx: Context;
  payload: SchemaType;
  jwt?: string;
};

// Factory that returns a Transformer
export const parseAndValidateRequestFactory = <T extends ZodSchema>() => {
  return async (
    item: ContextWithSchema<T>,
    _metadataHelper?: MetadataHelper,
  ): Promise<ContextWithParsedPayload<ZodInfer<T>>> => {
    const { ctx, schema } = item;

    try {
      const jsonPayload = await ctx.request.body.json();
      const validatedPayload = schema.parse(jsonPayload);
      return { ctx, payload: validatedPayload };
    } catch (error) {
      const shape = schema instanceof ZodObject
        ? schema.shape
        : "unknown shape";

      throw new Error(
        `Invalid payload: ${error} \n The correct format is: ${
          safeStringify(
            shape,
          )
        }`,
      );
    }
  };
};
