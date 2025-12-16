import { Router } from "@oak/oak";
import { lowRateLimitMiddleware } from "@/http/middleware/rate-limit/index.ts";
import { postBundleHandler } from "@/http/v1/bundle/post.ts";
import { getBundleHandler } from "@/http/v1/bundle/get.ts";
import { listBundlesHandler } from "@/http/v1/bundle/list.ts";
import { jwtMiddleware } from "@/http/middleware/auth/index.ts";

const bundleRouter = new Router();

bundleRouter.use(lowRateLimitMiddleware);
bundleRouter.use(jwtMiddleware);

// POST /v1/bundle - create/process operations bundle
bundleRouter.post("/bundle", postBundleHandler);

// GET /v1/bundle/:bundleId - retrieve bundle by ID
bundleRouter.get("/bundle/:bundleId", getBundleHandler);

// GET /v1/bundles - list all bundles created by the authenticated user
bundleRouter.get("/bundles", listBundlesHandler);

export default bundleRouter;
