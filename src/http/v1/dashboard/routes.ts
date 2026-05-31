import { Router } from "@oak/oak";
import type { Logger } from "@/utils/logger/index.ts";
import { handlePostChallenge } from "./auth/challenge.ts";
import { handlePostVerify } from "./auth/verify.ts";
import { handleGetChannels } from "./channels.ts";
import { handleGetMempool } from "./mempool.ts";
import { handleGetOperations } from "./operations.ts";
import { handleGetTreasury } from "./treasury.ts";
import { handleGetUtxos } from "./utxos.ts";
import {
  handleGetTransactionDetail,
  handleListDashboardTransactions,
} from "./transactions.ts";
import { handleGetAuditExport } from "./audit-export.ts";
import {
  handleDiscoverCouncil,
  handleGetMembership,
  handleJoinCouncil,
  handleSyncMembership,
} from "./council.ts";
import { handleDeletePp, handleListPps, handleRegisterPp } from "./pp.ts";
import { handlePostExpireBundles } from "./bundle-admin.ts";
import { handleGetBundleDetail, handleListRecentBundles } from "./bundles.ts";
import { handleGetMetrics } from "./metrics.ts";
import { jwtMiddleware } from "@/http/middleware/auth/index.ts";

export function buildDashboardRouter(deps: { log: Logger }): Router {
  const dashboardRouter = new Router();

  // --- Auth (public) ---
  dashboardRouter.post("/dashboard/auth/challenge", handlePostChallenge(deps));
  dashboardRouter.post("/dashboard/auth/verify", handlePostVerify(deps));

  // --- Admin (JWT required) ---
  dashboardRouter.post(
    "/dashboard/bundles/expire",
    jwtMiddleware(deps),
    handlePostExpireBundles(deps),
  );

  // --- Protected endpoints ---
  dashboardRouter.get(
    "/dashboard/channels",
    jwtMiddleware(deps),
    handleGetChannels(deps),
  );
  dashboardRouter.get(
    "/dashboard/mempool",
    jwtMiddleware(deps),
    handleGetMempool(deps),
  );
  dashboardRouter.get(
    "/dashboard/operations",
    jwtMiddleware(deps),
    handleGetOperations(deps),
  );
  dashboardRouter.get(
    "/dashboard/treasury",
    jwtMiddleware(deps),
    handleGetTreasury(deps),
  );
  dashboardRouter.get(
    "/dashboard/utxos",
    jwtMiddleware(deps),
    handleGetUtxos(deps),
  );
  dashboardRouter.get(
    "/dashboard/transactions",
    jwtMiddleware(deps),
    handleListDashboardTransactions(deps),
  );
  dashboardRouter.get(
    "/dashboard/transactions/:id",
    jwtMiddleware(deps),
    handleGetTransactionDetail(deps),
  );
  dashboardRouter.get(
    "/dashboard/bundles",
    jwtMiddleware(deps),
    handleListRecentBundles(deps),
  );
  dashboardRouter.get(
    "/dashboard/bundles/:id",
    jwtMiddleware(deps),
    handleGetBundleDetail(deps),
  );
  dashboardRouter.get(
    "/dashboard/audit-export",
    jwtMiddleware(deps),
    handleGetAuditExport(deps),
  );
  dashboardRouter.get(
    "/dashboard/metrics",
    jwtMiddleware(deps),
    handleGetMetrics(deps),
  );

  // --- PP management ---
  dashboardRouter.post(
    "/dashboard/pp/register",
    jwtMiddleware(deps),
    handleRegisterPp(deps),
  );
  dashboardRouter.get(
    "/dashboard/pp/list",
    jwtMiddleware(deps),
    handleListPps(deps),
  );
  dashboardRouter.post(
    "/dashboard/pp/delete",
    jwtMiddleware(deps),
    handleDeletePp(deps),
  );

  // --- Council (UC2) ---
  dashboardRouter.post(
    "/dashboard/council/discover",
    jwtMiddleware(deps),
    handleDiscoverCouncil(deps),
  );
  dashboardRouter.post(
    "/dashboard/council/join",
    jwtMiddleware(deps),
    handleJoinCouncil(deps),
  );
  dashboardRouter.get(
    "/dashboard/council/membership",
    jwtMiddleware(deps),
    handleGetMembership(deps),
  );
  dashboardRouter.post(
    "/dashboard/council/membership",
    jwtMiddleware(deps),
    handleSyncMembership(deps),
  );

  return dashboardRouter;
}
