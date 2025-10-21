import { ProcessEngine } from "@fifo/convee";
import { db } from "../../../db/config.ts";

import type { JwtSessionData } from "../../../api/middleware/auth/index.ts";
import type { ContextWithParsedQuery } from "../../../api/utils/parse-request-query.ts";
import type { GetTransactionsPayload } from "../../../api/v1/transactions/get.schema.ts";
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

    // if (result === null) {
    //   throw new Error("Not Found");
    // }

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
