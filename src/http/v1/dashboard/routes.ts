import { Router } from "@oak/oak";
import { postChallengeHandler } from "./auth/challenge.ts";
import { postVerifyHandler } from "./auth/verify.ts";
import { getChannelsHandler } from "./channels.ts";
import { getMempoolHandler } from "./mempool.ts";
import { getOperationsHandler } from "./operations.ts";
import { getTreasuryHandler } from "./treasury.ts";
import { getAuditExportHandler } from "./audit-export.ts";
import { discoverCouncilHandler, joinCouncilHandler, getMembershipHandler, syncMembershipHandler } from "./council.ts";
import { registerPpHandler, listPpsHandler, deletePpHandler } from "./pp.ts";
import { postExpireBundlesHandler } from "./bundle-admin.ts";
import { jwtMiddleware } from "@/http/middleware/auth/index.ts";

const dashboardRouter = new Router();

// --- Auth (public) ---
dashboardRouter.post("/dashboard/auth/challenge", postChallengeHandler);
dashboardRouter.post("/dashboard/auth/verify", postVerifyHandler);

// --- Admin (JWT required) ---
dashboardRouter.post("/dashboard/bundles/expire", jwtMiddleware, postExpireBundlesHandler);

// --- Protected endpoints (JWT checked inline per-route) ---
dashboardRouter.get("/dashboard/channels", jwtMiddleware, getChannelsHandler);
dashboardRouter.get("/dashboard/mempool", jwtMiddleware, getMempoolHandler);
dashboardRouter.get("/dashboard/operations", jwtMiddleware, getOperationsHandler);
dashboardRouter.get("/dashboard/treasury", jwtMiddleware, getTreasuryHandler);
dashboardRouter.get("/dashboard/audit-export", jwtMiddleware, getAuditExportHandler);

// --- PP management ---
dashboardRouter.post("/dashboard/pp/register", jwtMiddleware, registerPpHandler);
dashboardRouter.get("/dashboard/pp/list", jwtMiddleware, listPpsHandler);
dashboardRouter.post("/dashboard/pp/delete", jwtMiddleware, deletePpHandler);

// --- Council (UC2) ---
dashboardRouter.post("/dashboard/council/discover", jwtMiddleware, discoverCouncilHandler);
dashboardRouter.post("/dashboard/council/join", jwtMiddleware, joinCouncilHandler);
dashboardRouter.get("/dashboard/council/membership", jwtMiddleware, getMembershipHandler);
dashboardRouter.post("/dashboard/council/membership", jwtMiddleware, syncMembershipHandler);

export default dashboardRouter;
