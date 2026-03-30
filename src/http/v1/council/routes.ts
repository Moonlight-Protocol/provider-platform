import { Router } from "@oak/oak";
import { configPushHandler } from "./config-push.ts";
import { lowRateLimitMiddleware } from "@/http/middleware/rate-limit/index.ts";

const councilRouter = new Router();

// Public endpoint — authenticated via signed payload, not JWT
councilRouter.post("/council/config-push", lowRateLimitMiddleware, configPushHandler);

export default councilRouter;
