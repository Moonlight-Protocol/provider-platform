import { Router } from "@oak/oak";
import { postBundleHandler } from "@/http/v1/bundle/post.ts";
import { getBundleHandler } from "@/http/v1/bundle/get.ts";
import { listBundlesHandler } from "@/http/v1/bundle/list.ts";
import { jwtMiddleware } from "@/http/middleware/auth/index.ts";

const bundleRouter = new Router();

// PP-scoped bundle endpoints. ppPublicKey in the URL is required — there is
// no "default" PP; submitters must address one explicitly.
bundleRouter.post(
  "/providers/:ppPublicKey/bundles",
  jwtMiddleware,
  postBundleHandler,
);
bundleRouter.get(
  "/providers/:ppPublicKey/bundles/:bundleId",
  jwtMiddleware,
  getBundleHandler,
);
bundleRouter.get(
  "/providers/:ppPublicKey/bundles",
  jwtMiddleware,
  listBundlesHandler,
);

export default bundleRouter;
