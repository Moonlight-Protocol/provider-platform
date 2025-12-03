// import { ProcessEngine } from "@fifo/convee";
// import type { GetBundlePayload } from "../../../modules/bundle/http/v1/get.schema.ts";
// // import { db } from "../../../infra/config/index.ts";

// import type { JwtSessionData } from "../../../http/middleware/auth/index.ts";
// import type { ContextWithParsedQuery } from "../../../http/utils/parse-request-query.ts";

// export const LOAD_BUNDLE = ProcessEngine.create(
//   async (input: ContextWithParsedQuery<GetBundlePayload>) => {
//     // const ctx = input.ctx;
//     // const sessionData = ctx.state.session as JwtSessionData;

//     // const hash = input.query.hash;

//     // const loadedBundle = await db.bundles.findByPrimaryIndex("hash", hash);
//     // if (loadedBundle === null) {
//     //   throw new Error("Bundle Not Found");
//     // }

//     // if (loadedBundle.value.clientAccount !== sessionData.sub) {
//     //   throw new Error("Unauthorized");
//     // }

//     // return {
//     //   ctx,
//     //   bundle: loadedBundle.value,
//     // };
//     return await input;
//   },
//   {
//     name: "LoadBundleProcessEngine",
//   }
// );
