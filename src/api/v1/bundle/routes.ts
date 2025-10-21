import { Router } from "@oak/oak";
import { postBundleEndpoint } from "./post.process.ts";
import { getBundleEndpoint } from "./get.process.ts";
import { jwtMiddleware } from "../../middleware/auth/index.ts";

const bundleRouter = new Router();

bundleRouter.post("/bundle", jwtMiddleware, postBundleEndpoint);
bundleRouter.get("/bundle", jwtMiddleware, getBundleEndpoint);

export default bundleRouter;
