import { Router } from "@oak/oak";
import { postBundleEndpoint } from "@/http/v1/bundle/post.process.ts";
import { getBundleEndpoint } from "@/http/v1/bundle/get.process.ts";
import { jwtMiddleware } from "@/http/middleware/auth/index.ts";

const bundleRouter = new Router();

bundleRouter.post("/bundle", jwtMiddleware, postBundleEndpoint);
bundleRouter.get("/bundle", jwtMiddleware, getBundleEndpoint);

export default bundleRouter;
