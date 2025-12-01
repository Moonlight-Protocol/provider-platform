import { z } from "zod";
import { Status } from "@oak/oak";

export const baseSuccessResponseSchema = z.object({
  status: z.literal(Status.OK),
  message: z.string().optional(),
});

export const successResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  baseSuccessResponseSchema.extend({
    data: dataSchema.optional(),
  });

// Default schema for unions and general use
export const defaultSuccessResponseSchema = successResponseSchema(z.any());

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
  defaultSuccessResponseSchema,
  errorResponseSchema,
]);

export type BaseSuccessResponse = z.infer<typeof baseSuccessResponseSchema>;
export type ApiResponse = z.infer<typeof responseSchema>;
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
export type SuccessResponse<T = unknown> = BaseSuccessResponse & { data?: T };
