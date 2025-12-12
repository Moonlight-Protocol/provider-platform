import { z } from "npm:zod@3.24.2";
import { baseSuccessResponseSchema } from "../../default-schemas.ts";

export const postBundleSchema = z.object({
  operationsMLXDR: z.array(z.string()).min(1),
});

export type PostBundlePayload = z.infer<typeof postBundleSchema>;

export const postBundleResSchema = baseSuccessResponseSchema.extend({
  data: z.object({
    operationsBundleId: z.string(),
    transactionHash: z.string(),
  }),
});
export type PostBundleResPayload = z.infer<typeof postBundleResSchema>;
