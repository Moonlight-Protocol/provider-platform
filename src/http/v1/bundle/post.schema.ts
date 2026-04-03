import { z } from "zod";
import { baseSuccessResponseSchema } from "@/http/default-schemas.ts";
import { BUNDLE_MAX_OPERATIONS } from "@/config/env.ts";

export const postBundleSchema = z.object({
  operationsMLXDR: z.array(z.string()).min(1).max(BUNDLE_MAX_OPERATIONS),
});

export type PostBundlePayload = z.infer<typeof postBundleSchema>;

export const postBundleResSchema = baseSuccessResponseSchema.extend({
  data: z.object({
    operationsBundleId: z.string(),
    transactionHash: z.string(),
  }),
});
export type PostBundleResPayload = z.infer<typeof postBundleResSchema>;
