import { z } from "npm:zod@3.24.2";
import { baseSuccessResponseSchema } from "../../default-schemas.ts";
import { rawBundleSchema } from "../../../models/bundle/bundle.schema.ts";

export const postBundleSchema = z.object({
  bundle: rawBundleSchema,
});

export type PostBundlePayload = z.infer<typeof postBundleSchema>;

export const postBundleResSchema = baseSuccessResponseSchema.extend({
  data: z.object({
    transactionHash: z.string(),
    bundleHash: z.string(),
  }),
});
export type PostBundleResPayload = z.infer<typeof postBundleResSchema>;
