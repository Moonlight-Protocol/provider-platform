import { Router } from "@oak/oak";
import { lowRateLimitMiddleware } from "@/http/middleware/rate-limit/index.ts";
import { postBundleHandler } from "@/http/v1/bundle/post.ts";
import { jwtMiddleware } from "@/http/middleware/auth/index.ts";

const bundleRouter = new Router();

bundleRouter.use(lowRateLimitMiddleware);
bundleRouter.use(jwtMiddleware);
bundleRouter.post("/bundle", postBundleHandler);

export default bundleRouter;
