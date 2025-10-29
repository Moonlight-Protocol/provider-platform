import { z } from "npm:zod@3.24.2";
import { baseSuccessResponseSchema } from "../../default-schemas.ts";
import { bundleModel } from "../../../models/bundle/bundle.model.ts";

export const getBundleSchema = z.object({
  hash: z.string(),
});
export type GetBundlePayload = z.infer<typeof getBundleSchema>;

export const getBundleResSchema = baseSuccessResponseSchema.extend({
  data: bundleModel,
});

export type GetBundleResPayload = z.infer<typeof getBundleResSchema>;
