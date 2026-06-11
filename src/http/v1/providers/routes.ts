import { Router } from "@oak/oak";
import type { Logger } from "@/utils/logger/index.ts";
import { jwtMiddleware } from "@/http/middleware/auth/index.ts";
import {
  requirePpExists,
  requirePpOwnership,
} from "@/http/middleware/require-pp-ownership.ts";
import { handleGetChannels } from "@/http/v1/dashboard/channels.ts";
import { handleGetMempool } from "@/http/v1/dashboard/mempool.ts";
import { handleGetOperations } from "@/http/v1/dashboard/operations.ts";
import { handleGetTreasury } from "@/http/v1/dashboard/treasury.ts";
import { handleGetUtxos } from "@/http/v1/dashboard/utxos.ts";
import {
  handleGetTransactionDetail,
  handleListDashboardTransactions,
} from "@/http/v1/dashboard/transactions.ts";
import {
  handleGetBundleDetail,
  handleListRecentBundles,
} from "@/http/v1/dashboard/bundles.ts";
import { handleGetAuditExport } from "@/http/v1/dashboard/audit-export.ts";
import { handleGetMetrics } from "@/http/v1/dashboard/metrics.ts";
import { handleDeletePp } from "@/http/v1/dashboard/pp.ts";
import {
  handleGetMembership,
  handleJoinCouncil,
  handleSyncMembership,
} from "@/http/v1/dashboard/council.ts";
import { handleEventsWs } from "@/http/v1/events/ws-handler.ts";
import { handlePostEntity } from "@/http/v1/entities/post.ts";
import { handlePostEntityChallenge } from "@/http/v1/entities/challenge.ts";
import { handleGetEntities } from "@/http/v1/entities/get.ts";

/**
 * /api/v1/providers/:ppPublicKey/...
 *
 * Every per-provider endpoint lives here. The PP is resolved from the URL
 * path; handlers must not fall back to JWT / body / query for PP
 * identification.
 *
 * Auth model per route:
 *   - JWT-protected operator endpoints use [jwtMiddleware, requirePpOwnership].
 *   - Public per-PP endpoints (KYC submission) use [requirePpExists] only.
 *   - The events WebSocket route uses its own bearer-via-subprotocol auth and
 *     does its own ownership check (it cannot consume jwtMiddleware because
 *     the JWT travels in Sec-WebSocket-Protocol, not Authorization).
 */
export function buildProvidersRouter(deps: { log: Logger }): Router {
  const router = new Router();

  const op = (): [
    ReturnType<typeof jwtMiddleware>,
    ReturnType<typeof requirePpOwnership>,
  ] => [jwtMiddleware(deps), requirePpOwnership(deps)];

  // --- PP lifecycle ---
  router.delete(
    "/providers/:ppPublicKey",
    ...op(),
    handleDeletePp(deps),
  );

  // --- Channels / mempool / operations (snapshots scoped to this PP) ---
  router.get(
    "/providers/:ppPublicKey/channels",
    ...op(),
    handleGetChannels(deps),
  );
  router.get(
    "/providers/:ppPublicKey/mempool",
    ...op(),
    handleGetMempool(deps),
  );
  router.get(
    "/providers/:ppPublicKey/operations",
    ...op(),
    handleGetOperations(deps),
  );

  // --- Treasury / UTXOs ---
  router.get(
    "/providers/:ppPublicKey/treasury",
    ...op(),
    handleGetTreasury(deps),
  );
  router.get(
    "/providers/:ppPublicKey/utxos",
    ...op(),
    handleGetUtxos(deps),
  );

  // --- Transactions ---
  router.get(
    "/providers/:ppPublicKey/transactions",
    ...op(),
    handleListDashboardTransactions(deps),
  );
  router.get(
    "/providers/:ppPublicKey/transactions/:id",
    ...op(),
    handleGetTransactionDetail(deps),
  );

  // --- Provider-scoped bundle list + detail (operator vantage). The
  // entity-scoped sibling endpoints live at /providers/:pp/entity/bundles/...
  // (bundle/routes.ts) and use end-user JWT auth.
  router.get(
    "/providers/:ppPublicKey/bundles",
    ...op(),
    handleListRecentBundles(deps),
  );
  router.get(
    "/providers/:ppPublicKey/bundles/:id",
    ...op(),
    handleGetBundleDetail(deps),
  );

  // --- Audit export / metrics ---
  router.get(
    "/providers/:ppPublicKey/audit-export",
    ...op(),
    handleGetAuditExport(deps),
  );
  router.get(
    "/providers/:ppPublicKey/metrics",
    ...op(),
    handleGetMetrics(deps),
  );

  // --- Entities that have interacted with this PP (operator view) ---
  router.get(
    "/providers/:ppPublicKey/entities",
    ...op(),
    handleGetEntities(deps),
  );

  // --- Council membership lifecycle ---
  router.post(
    "/providers/:ppPublicKey/council/join",
    ...op(),
    handleJoinCouncil(deps),
  );
  router.get(
    "/providers/:ppPublicKey/council/membership",
    ...op(),
    handleGetMembership(deps),
  );
  router.post(
    "/providers/:ppPublicKey/council/membership",
    ...op(),
    handleSyncMembership(deps),
  );

  // --- Events WS (custom auth; handler reads :ppPublicKey directly) ---
  router.get(
    "/providers/:ppPublicKey/events/ws",
    handleEventsWs(deps),
  );

  // --- Public KYC/KYB submission (no JWT; PP must exist; SEP-53 sig req'd) ---
  router.post(
    "/providers/:ppPublicKey/entities/challenge",
    requirePpExists(deps),
    handlePostEntityChallenge(deps),
  );
  router.post(
    "/providers/:ppPublicKey/entities",
    requirePpExists(deps),
    handlePostEntity(deps),
  );

  return router;
}
