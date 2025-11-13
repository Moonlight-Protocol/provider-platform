import { z } from "npm:zod@3.24.2";
import { gAccountPublicKey } from "@/utils/regex/gAccountPublicKey.ts";
import { baseSuccessResponseSchema } from "@/http/default-schemas.ts";

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
