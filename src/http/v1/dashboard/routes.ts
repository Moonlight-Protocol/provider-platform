import { Router } from "@oak/oak";
import { postChallengeHandler } from "./auth/challenge.ts";
import { postVerifyHandler } from "./auth/verify.ts";
import { getChannelsHandler } from "./channels.ts";
import { getMempoolHandler } from "./mempool.ts";
import { getOperationsHandler } from "./operations.ts";
import { getTreasuryHandler } from "./treasury.ts";
import { getAuditExportHandler } from "./audit-export.ts";
import { jwtMiddleware } from "@/http/middleware/auth/index.ts";
import { lowRateLimitMiddleware } from "@/http/middleware/rate-limit/index.ts";

const dashboardRouter = new Router();

// --- Auth (public, strict rate limit) ---
dashboardRouter.post("/dashboard/auth/challenge", lowRateLimitMiddleware, postChallengeHandler);
dashboardRouter.post("/dashboard/auth/verify", lowRateLimitMiddleware, postVerifyHandler);

// --- Protected endpoints ---
dashboardRouter.use("/dashboard", jwtMiddleware);

dashboardRouter.get("/dashboard/channels", getChannelsHandler);
dashboardRouter.get("/dashboard/mempool", getMempoolHandler);
dashboardRouter.get("/dashboard/operations", getOperationsHandler);
dashboardRouter.get("/dashboard/treasury", getTreasuryHandler);
dashboardRouter.get("/dashboard/audit-export", getAuditExportHandler);

export default dashboardRouter;
