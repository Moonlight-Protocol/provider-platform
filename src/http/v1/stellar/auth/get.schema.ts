import { z } from "npm:zod@3.24.2";
import { baseSuccessResponseSchema } from "../../../default-schemas.ts";
import { gAccountPublicKey } from "../../../../utils/regex/gAccountPublicKey.ts";

export const getAuthSchema = z.object({
  account: z.string().regex(gAccountPublicKey),
});
export type GetAuthPayload = z.infer<typeof getAuthSchema>;

export const getAuthResSchema = baseSuccessResponseSchema.extend({
  data: z.object({
    hash: z.string(),
    challenge: z.string(),
  }),
});
export type GetAuthResPayload = z.infer<typeof getAuthResSchema>;
