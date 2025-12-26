import { z } from "zod";
import { type Context, Status } from "@oak/oak";
import { P_ListBundlesByUser } from "@/core/service/bundle/list-bundles.process.ts";
import type { GetEndpointOutput } from "@/http/pipelines/types.ts";
import { PIPE_GetEndpoint } from "@/http/pipelines/get-endpoint.ts";
import { LOG } from "@/config/logger.ts";
import { BundleStatus } from "@/persistence/drizzle/entity/operations-bundle.entity.ts";

// Reuse the bundle item schema from get.ts
const bundleItemSchema = z.object({
  id: z.string(),
  status: z.string(),
  ttl: z.string(),
  operationsMLXDR: z.array(z.string()),
  fee: z.string(),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
});

export const requestSchema = z.object({
  status: z.enum([
    BundleStatus.PENDING,
    BundleStatus.PROCESSING,
    BundleStatus.COMPLETED,
    BundleStatus.EXPIRED,
  ]).optional(),
});

export const responseSchema = z.object({
  bundles: z.array(bundleItemSchema),
});

export type BundleListProcessOutput = {
  ctx: Context;
  bundles: z.infer<typeof bundleItemSchema>[];
};

const assembleResponse = (
  input: BundleListProcessOutput,
): GetEndpointOutput<typeof responseSchema> => {
  const message = "Bundles successfully retrieved";

  LOG.info(message, { count: input.bundles.length });

  return {
    ctx: input.ctx,
    status: Status.OK,
    message,
    data: {
      bundles: input.bundles,
    },
  };
};

export const listBundlesHandler = (ctx: Context) => {
  const handler = PIPE_GetEndpoint({
    name: "ListBundlesEndpointPipeline",
    requestSchema,
    responseSchema,
    steps: [
      P_ListBundlesByUser,
      assembleResponse,
    ],
  });

  return handler.run(ctx);
};

