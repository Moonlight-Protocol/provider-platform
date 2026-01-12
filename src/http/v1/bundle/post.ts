import { z } from "zod";
import { type Context, Status } from "@oak/oak";
import { P_AddOperationsBundle } from "@/core/service/bundle/add-bundle.process.ts";
import type { PostEndpointOutput } from "@/http/pipelines/types.ts";
import { PIPE_PostEndpoint } from "@/http/pipelines/post-endpoint.ts";
import { LOG } from "@/config/logger.ts";

export const requestSchema = z.object({
  operationsMLXDR: z.array(z.string()).min(1),
});

export const responseSchema = z.object({
  operationsBundleId: z.string(),
  status: z.string(),
});

type BundleProcessOutput = {
  ctx: Context;
  operationsBundleId: string;
};

const assembleResponse = (
  input: BundleProcessOutput
): PostEndpointOutput<typeof responseSchema> => {
  const message = "Bundle received and queued for processing";

  LOG.info(message, { bundleId: input.operationsBundleId });

  return {
    ctx: input.ctx,
    status: Status.OK,
    message,
    data: {
      operationsBundleId: input.operationsBundleId,
      status: "PENDING",
    },
  };
};

export const postBundleHandler = (ctx: Context) => {
  const handler = PIPE_PostEndpoint({
    name: "PostBundleEndpointPipeline",
    requestSchema: requestSchema,
    responseSchema: responseSchema,
    steps: [
      P_AddOperationsBundle,
      assembleResponse,
    ],
  });

  return handler.run(ctx);
};

