import { appendSchemaToContextFactory } from "../../utils/append-schema-to-context.ts";
import { Pipeline } from "@fifo/convee";
import {
  ContextWithParsedQuery,
  parseAndValidateQueryFactory,
} from "../../utils/parse-request-query.ts";
import {
  GetTransactionsPayload,
  GetTransactionsResPayload,
  getTransactionsResSchema,
  getTransactionsSchema,
} from "./get.schema.ts";
import { processErrorResponsePluginFactory } from "../../utils/plugins/process-error-response.ts";
import { BundleModel } from "../../../models/bundle/bundle.model.ts";
import { ContextWith } from "../../types.ts";
import { Context, Status } from "@oak/oak";
import { LOAD_BUNDLES } from "../../../core/bundle/processes/load-bundles.ts";
import { z } from "zod";
import { setApiResponse } from "../../utils/set-api-response.ts";

const appendSchema = appendSchemaToContextFactory(getTransactionsSchema);
const parse = parseAndValidateQueryFactory<typeof getTransactionsSchema>();

const setSuccessResponse = async (
  input: ContextWith<BundleModel[], "bundles">
) => {
  return {
    ctx: input.ctx,
    response: {
      status: Status.OK,
      message: `${input.bundles.length} Transactions found!`,
      data: input.bundles,
    } as GetTransactionsResPayload,
  };
};

const getTransactionsPipeline = Pipeline.create(
  [appendSchema, parse, LOAD_BUNDLES, setSuccessResponse, setApiResponse],
  {
    name: "GetTransactionsPipeline",
  }
);

export const getTransactionsEndpoint = (ctx: Context) => {
  const errorPlugin = processErrorResponsePluginFactory(ctx);

  getTransactionsPipeline.addPlugin(errorPlugin, getTransactionsPipeline.name);

  return getTransactionsPipeline.run(ctx);
};
