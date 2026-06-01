import { Router } from "@oak/oak";
import type { Logger } from "@/utils/logger/index.ts";
import { handlePostBundle } from "@/http/v1/bundle/post.ts";
import { handleGetBundle } from "@/http/v1/bundle/get.ts";
import { handleListBundles } from "@/http/v1/bundle/list.ts";
import { jwtMiddleware } from "@/http/middleware/auth/index.ts";

/**
 * Entity-scoped bundle endpoints — the URL `/providers/:ppPublicKey/entity/...`
 * means "the calling entity's view of this PP's bundles". The entity is the
 * bundle submitter (a user wallet or a business wallet) authenticated via
 * the SEP-10 stellar/auth flow; the JWT carries a session that points at the
 * entity's account row.
 *
 * The bare `/providers/:ppPublicKey/bundles` namespace is the provider's view
 * (operator JWT + ownership check), wired in providers/routes.ts. Same noun,
 * opposite vantages — the URL makes the scope explicit so callers don't have
 * to know which auth principal applies.
 */
export function buildBundleRouter(deps: { log: Logger }): Router {
  const bundleRouter = new Router();
  bundleRouter.post(
    "/providers/:ppPublicKey/entity/bundles",
    jwtMiddleware(deps),
    handlePostBundle(deps),
  );
  bundleRouter.get(
    "/providers/:ppPublicKey/entity/bundles/:bundleId",
    jwtMiddleware(deps),
    handleGetBundle(deps),
  );
  bundleRouter.get(
    "/providers/:ppPublicKey/entity/bundles",
    jwtMiddleware(deps),
    handleListBundles(deps),
  );
  return bundleRouter;
}
