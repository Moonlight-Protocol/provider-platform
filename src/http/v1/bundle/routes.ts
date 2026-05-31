import { Router } from "@oak/oak";
import type { Logger } from "@/utils/logger/index.ts";
import { handlePostBundle } from "@/http/v1/bundle/post.ts";
import { handleGetBundle } from "@/http/v1/bundle/get.ts";
import { handleListBundles } from "@/http/v1/bundle/list.ts";
import { jwtMiddleware } from "@/http/middleware/auth/index.ts";

export function buildBundleRouter(deps: { log: Logger }): Router {
  const bundleRouter = new Router();
  // PP-scoped bundle endpoints. ppPublicKey in the URL is required — there
  // is no "default" PP; submitters must address one explicitly.
  bundleRouter.post(
    "/providers/:ppPublicKey/bundles",
    jwtMiddleware(deps),
    handlePostBundle(deps),
  );
  bundleRouter.get(
    "/providers/:ppPublicKey/bundles/:bundleId",
    jwtMiddleware(deps),
    handleGetBundle(deps),
  );
  bundleRouter.get(
    "/providers/:ppPublicKey/bundles",
    jwtMiddleware(deps),
    handleListBundles(deps),
  );
  return bundleRouter;
}
