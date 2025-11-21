import { z } from "npm:zod@3.24.2";
import { bundleModel } from "@/models/bundle/bundle.model.ts";
import { dateSchema } from "@/utils/schema/date.ts";
import { baseSuccessResponseSchema } from "@/http/default-schemas.ts";

export const getTransactionsSchema = z.object({
  createdAfter: dateSchema.optional(),
  createdBefore: dateSchema.optional(),
  clientPublicKey: z.string(),
});
export type GetTransactionsPayload = z.infer<typeof getTransactionsSchema>;

export const getTransactionsResSchema = baseSuccessResponseSchema.extend({
  data: z.array(bundleModel),
});

export type GetTransactionsResPayload = z.infer<
  typeof getTransactionsResSchema
>;
