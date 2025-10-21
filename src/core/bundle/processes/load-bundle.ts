import { ProcessEngine } from "@fifo/convee";
import { GetBundlePayload } from "../../../api/v1/bundle/get.schema.ts";
import { db } from "../../../db/config.ts";

import { JwtSessionData } from "../../../api/middleware/auth/index.ts";
import { ContextWithParsedQuery } from "../../../api/utils/parse-request-query.ts";

export const LOAD_BUNDLE = ProcessEngine.create(
  async (input: ContextWithParsedQuery<GetBundlePayload>) => {
    const ctx = input.ctx;
    const sessionData = ctx.state.session as JwtSessionData;

    const hash = input.query.hash;

    const loadedBundle = await db.bundles.findByPrimaryIndex("hash", hash);
    if (loadedBundle === null) {
      throw new Error("Not Found");
    }

    if (loadedBundle.value.clientAccount !== sessionData.sub) {
      throw new Error("Unauthorized");
    }

    return {
      ctx,
      bundle: loadedBundle.value,
    };
  },
  {
    name: "LoadBundleProcessEngine",
  }
);
