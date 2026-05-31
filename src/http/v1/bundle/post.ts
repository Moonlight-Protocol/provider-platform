import { z } from "zod";
import { type Context, Status } from "@oak/oak";
import { P_AddOperationsBundle } from "@/core/service/bundle/add-bundle.process.ts";
import type { PostEndpointOutput } from "@/http/pipelines/types.ts";
import { PIPE_PostEndpoint } from "@/http/pipelines/post-endpoint.ts";
import type { Logger } from "@/utils/logger/index.ts";
import { BUNDLE_MAX_OPERATIONS } from "@/config/env.ts";
import { bundleRequestSchema } from "@/http/v1/bundle/bundle.schemas.ts";

export const requestSchema = bundleRequestSchema(BUNDLE_MAX_OPERATIONS);

export const responseSchema = z.object({
  operationsBundleId: z.string(),
  status: z.string(),
});

type BundleProcessOutput = {
  ctx: Context;
  operationsBundleId: string;
};

export function handlePostBundle(
  deps: { log: Logger },
): (ctx: Context) => Promise<unknown> {
  const log = deps.log.scope("postBundle");

  const assembleResponse = (
    input: BundleProcessOutput,
  ): PostEndpointOutput<typeof responseSchema> => {
    log.debug("bundleId", input.operationsBundleId);
    log.event("bundle received and queued for processing");

    return {
      ctx: input.ctx,
      status: Status.OK,
      message: "Bundle received and queued for processing",
      data: {
        operationsBundleId: input.operationsBundleId,
        status: "PENDING",
      },
    };
  };

  return (ctx) => {
    log.info("postBundle");
    const handler = PIPE_PostEndpoint({
      name: "PostBundleEndpointPipeline",
      requestSchema: requestSchema,
      responseSchema: responseSchema,
      steps: [
        P_AddOperationsBundle(deps),
        assembleResponse,
      ],
    }, deps);

    return handler.run(ctx);
  };
}
