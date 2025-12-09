import { Router } from "@oak/oak";
import { lowRateLimitMiddleware } from "@/http/middleware/rate-limit/index.ts";
import { postAuthHandler } from "@/http/v1/stellar/auth/post.ts";
import { getAuthHandler } from "@/http/v1/stellar/auth/get.ts";
const authRouter = new Router();

authRouter.use(lowRateLimitMiddleware);

authRouter.post("/auth", postAuthHandler);
authRouter.get("/auth", getAuthHandler);

export default authRouter;
