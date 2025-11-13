import { z } from "npm:zod@3.24.2";
import { baseSuccessResponseSchema } from "@/http/default-schemas.ts";
export const postAuthSchema = z.object({
  signedChallenge: z.string(),
});

export type PostAuthPayload = z.infer<typeof postAuthSchema>;

export const postAuthResSchema = baseSuccessResponseSchema.extend({
  data: z.object({
    jwt: z.string(),
  }),
});
export type PostAuthResPayload = z.infer<typeof postAuthResSchema>;
