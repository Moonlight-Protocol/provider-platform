import { ProcessEngine } from "@fifo/convee";
import { db } from "../../../infra/config/config.ts";

import type { JwtSessionData } from "../../../http/middleware/auth/index.ts";
import type { ContextWithParsedQuery } from "../../../http/utils/parse-request-query.ts";
import type { GetTransactionsPayload } from "../../../http/v1/transactions/get.schema.ts";
import type { BundleModel } from "../../../models/bundle/bundle.model.ts";

export const LOAD_BUNDLES = ProcessEngine.create(
  async (input: ContextWithParsedQuery<GetTransactionsPayload>) => {
    const ctx = input.ctx;
    const sessionData = ctx.state.session as JwtSessionData;

    const {
      clientPublicKey: clientPk,
      // createdAfter,
      // createdBefore,
    } = input.query;

    const dbQueryResult = await db.bundles.findBySecondaryIndex(
      "status",
      "confirmed",
      {
        filter: (doc) => doc.value.clientAccount === clientPk,
      }
    );

    const loadedBundles = dbQueryResult === null ? [] : dbQueryResult.result;

    loadedBundles.forEach((bundle) => {
      if (bundle.value.clientAccount !== sessionData.sub) {
        throw new Error("Unauthorized");
      }
    });

    return {
      ctx,
      bundles: loadedBundles.map((bundle) => bundle.value) as BundleModel[],
    };
  },
  {
    name: "LoadBundlesProcessEngine",
  }
);
