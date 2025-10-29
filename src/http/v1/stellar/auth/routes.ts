import { Router } from "@oak/oak";
import { getAuthEndpoint } from "./get.process.ts";
import { lowRateLimitMiddleware } from "../../../middleware/rate-limit.ts";
import { postAuthEndpoint } from "./post.process.ts";
const authRouter = new Router();

authRouter.use(lowRateLimitMiddleware);

authRouter.post("/auth", postAuthEndpoint);
authRouter.get("/auth", getAuthEndpoint);

export default authRouter;
