import { z } from "npm:zod@3.24.2";
import { Status } from "@oak/oak";

export const baseSuccessResponseSchema = z.object({
  status: z.literal(Status.OK),
  message: z.string().optional(),
});

export const successResponseSchema = baseSuccessResponseSchema.extend({
  data: z.any().optional(),
});

export const errorResponseSchema = z.object({
  status: z.union([
    z.literal(Status.BadRequest),
    z.literal(Status.Unauthorized),
    z.literal(Status.Forbidden),
    z.literal(Status.NotFound),
    z.literal(Status.InternalServerError),
  ]),
  message: z.string(),
  data: z.object({
    error: z.string(),
    meta: z.any().optional(),
  }),
});

export const responseSchema = z.union([
  successResponseSchema,
  errorResponseSchema,
]);

export type ApiResponse = z.infer<typeof responseSchema>;
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
export type SuccessResponse = z.infer<typeof successResponseSchema>;
