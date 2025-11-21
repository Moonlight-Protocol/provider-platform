import { Context } from "@oak/oak";
import { ZodSchema } from "zod";
import { appendObjectsTransformerFactory } from "../../utils/append/append-obj.ts";

export const appendSchemaToContextFactory = <S extends ZodSchema>(schema: S) =>
  appendObjectsTransformerFactory<"schema", S, "ctx", Context>(
    "schema",
    schema,
    "ctx",
  );
