import { appendSchemaToContextFactory } from "@/http/utils/append-schema-to-context.ts";
import { Pipeline } from "@fifo/convee";
import { parseAndValidateQueryFactory } from "@/http/utils/parse-request-query.ts";
import {
  type GetTransactionsResPayload,
  getTransactionsSchema,
} from "@/http/v1/transactions/get.schema.ts";
import { processErrorResponsePluginFactory } from "@/http/utils/plugins/process-error-response.ts";
import type { BundleModel } from "@/models/bundle/bundle.model.ts";
import type { ContextWith } from "@/http/types.ts";
import { type Context, Status } from "@oak/oak";
import { LOAD_BUNDLES } from "@/core/bundle/processes/load-bundles.ts";
import { setApiResponse } from "@/http/utils/set-api-response.ts";

const appendSchema = appendSchemaToContextFactory(getTransactionsSchema);
const parse = parseAndValidateQueryFactory<typeof getTransactionsSchema>();

const setSuccessResponse = async (
  input: ContextWith<BundleModel[], "bundles">
) => {
  return await {
    ctx: input.ctx,
    response: {
      status: Status.OK,
      message: `${input.bundles.length} Transactions found!`,
      data: input.bundles,
    } as GetTransactionsResPayload,
  };
};

export const getTransactionsEndpoint = (ctx: Context) => {
  const getTransactionsPipeline = Pipeline.create(
    [
      appendSchema,
      parse,
      LOAD_BUNDLES,
      setSuccessResponse,
      setApiResponse,
    ],
    {
      name: "GetTransactionsPipeline",
    }
  );
  const errorPlugin = processErrorResponsePluginFactory(ctx);

  getTransactionsPipeline.addPlugin(errorPlugin, getTransactionsPipeline.name);

  return getTransactionsPipeline.run(ctx);
};
