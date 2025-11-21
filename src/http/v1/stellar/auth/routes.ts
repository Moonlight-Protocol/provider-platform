import { Router } from "@oak/oak";
import { getAuthEndpoint } from "@/http/v1/stellar/auth/get.process.ts";
import { lowRateLimitMiddleware } from "@/http/middleware/rate-limit.ts";
import { postAuthEndpoint } from "@/http/v1/stellar/auth/post.process.ts";
const authRouter = new Router();

authRouter.use(lowRateLimitMiddleware);

authRouter.post("/auth", postAuthEndpoint);
authRouter.get("/auth", getAuthEndpoint);

export default authRouter;
