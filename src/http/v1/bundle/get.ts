import { z } from "zod";
import { type Context, Status } from "@oak/oak";
import { P_GetBundleById } from "@/core/service/bundle/get-bundle.process.ts";
import type { GetEndpointOutput } from "@/http/pipelines/types.ts";
import { PIPE_GetEndpoint } from "@/http/pipelines/get-endpoint.ts";
import type { Logger } from "@/utils/logger/index.ts";

export const requestSchema = z.object({
  bundleId: z.string().min(1),
});

export const responseSchema = z.object({
  id: z.string(),
  status: z.string(),
  ttl: z.string(),
  operationsMLXDR: z.array(z.string()),
  fee: z.string(),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
});

export type BundleGetProcessOutput = {
  ctx: Context;
  bundle: z.infer<typeof responseSchema>;
};

export function handleGetBundle(
  deps: { log: Logger },
): (ctx: Context) => Promise<unknown> {
  const log = deps.log.scope("getBundle");

  const assembleResponse = (
    input: BundleGetProcessOutput,
  ): GetEndpointOutput<typeof responseSchema> => {
    log.event("bundle successfully retrieved");

    return {
      ctx: input.ctx,
      status: Status.OK,
      message: "Bundle successfully retrieved",
      data: input.bundle,
    };
  };

  return (ctx) => {
    log.info("getBundle");
    // Map path param :bundleId into query string so PIPE_GetEndpoint +
    // P_ParseRequestQuery can validate and pass it through normally.
    type RouteParams = { bundleId?: string };
    const params = (ctx as unknown as { params?: RouteParams }).params;
    if (params?.bundleId) {
      const bundleId = params.bundleId;
      ctx.request.url.searchParams.set("bundleId", bundleId);
    }

    const handler = PIPE_GetEndpoint({
      name: "GetBundleEndpointPipeline",
      requestSchema,
      responseSchema,
      steps: [
        P_GetBundleById(deps),
        assembleResponse,
      ],
    }, deps);

    return handler.run(ctx);
  };
}
