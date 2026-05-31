import { z } from "zod";
import { type Context, Status } from "@oak/oak";
import { P_ListBundlesByUser } from "@/core/service/bundle/list-bundles.process.ts";
import type { GetEndpointOutput } from "@/http/pipelines/types.ts";
import { PIPE_GetEndpoint } from "@/http/pipelines/get-endpoint.ts";
import type { Logger } from "@/utils/logger/index.ts";
import { BundleStatus } from "@/persistence/drizzle/entity/operations-bundle.entity.ts";

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

export function handleListBundles(
  deps: { log: Logger },
): (ctx: Context) => Promise<unknown> {
  const log = deps.log.scope("listBundles");

  const assembleResponse = (
    input: BundleListProcessOutput,
  ): GetEndpointOutput<typeof responseSchema> => {
    log.debug("count", input.bundles.length);
    log.event("bundles successfully retrieved");

    return {
      ctx: input.ctx,
      status: Status.OK,
      message: "Bundles successfully retrieved",
      data: {
        bundles: input.bundles,
      },
    };
  };

  return (ctx) => {
    log.info("listBundles");
    const handler = PIPE_GetEndpoint({
      name: "ListBundlesEndpointPipeline",
      requestSchema,
      responseSchema,
      steps: [
        P_ListBundlesByUser(deps),
        assembleResponse,
      ],
    }, deps);

    return handler.run(ctx);
  };
}
