import { appendSchemaToContextFactory } from "../../utils/append-schema-to-context.ts";
import { Pipeline } from "@fifo/convee";
import {
  ContextWithParsedQuery,
  parseAndValidateQueryFactory,
} from "../../utils/parse-request-query.ts";
import {
  GetBundlePayload,
  GetBundleResPayload,
  getBundleSchema,
} from "./get.schema.ts";
import { processErrorResponsePluginFactory } from "../../utils/plugins/process-error-response.ts";
import { LOAD_BUNDLE } from "../../../core/bundle/processes/load-bundle.ts";
import { BundleModel } from "../../../models/bundle/bundle.model.ts";
import { ContextWith } from "../../types.ts";
import { Context, Status } from "@oak/oak";
import { setApiResponse } from "../../utils/set-api-response.ts";

const appendSchema = appendSchemaToContextFactory(getBundleSchema);
const parse = parseAndValidateQueryFactory<typeof getBundleSchema>();

const setSuccessResponse = async (
  input: ContextWith<BundleModel, "bundle">
) => {
  return {
    ctx: input.ctx,
    response: {
      status: Status.OK,
      message: "Bundle found!",
      data: input.bundle,
    } as GetBundleResPayload,
  };
};

export const getBundleEndpoint = (ctx: Context) => {
  const getBundlePipeline = Pipeline.create(
    [appendSchema, parse, LOAD_BUNDLE, setSuccessResponse, setApiResponse],
    {
      name: "GetBundlePipeline",
    }
  );

  const errorPlugin = processErrorResponsePluginFactory(ctx);

  getBundlePipeline.addPlugin(errorPlugin, getBundlePipeline.name);

  return getBundlePipeline.run(ctx);
};
