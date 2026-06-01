import { type Context, Status } from "@oak/oak";
import { and, desc, eq, gte, isNull } from "drizzle-orm";
import {
  MoonlightOperation,
  type OperationTypes,
} from "@moonlight/moonlight-sdk";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { OperationsBundleRepository } from "@/persistence/drizzle/repository/operations-bundle.repository.ts";
import { operationsBundle } from "@/persistence/drizzle/entity/operations-bundle.entity.ts";
import { account } from "@/persistence/drizzle/entity/account.entity.ts";
import { entity } from "@/persistence/drizzle/entity/entity.entity.ts";
import type { PaymentProvider } from "@/persistence/drizzle/entity/pp.entity.ts";
import type { Logger } from "@/utils/logger/index.ts";

const bundleRepo = new OperationsBundleRepository(drizzleClient);

const LIST_DEFAULT_LIMIT = 25;
const LIST_MAX_LIMIT = 200;
const LIST_WINDOW_MS = 6 * 60 * 60 * 1000;

type RouteParams = { id?: string };
type OpKind = "deposit" | "withdraw" | "spend" | "create" | "unknown";
type ParsedOp =
  | OperationTypes.CreateOperation
  | OperationTypes.SpendOperation
  | OperationTypes.DepositOperation
  | OperationTypes.WithdrawOperation;

interface OpView {
  kind: OpKind;
  address?: string;
  amount?: string;
}

function aggregateAmountFromMLXDR(mlxdrs: string[]): string | null {
  let depositSum = 0n;
  let withdrawSum = 0n;
  let createSum = 0n;
  let hasDeposit = false;
  let hasWithdraw = false;
  let hasCreate = false;
  for (const mlxdr of mlxdrs) {
    try {
      const op = MoonlightOperation.fromMLXDR(mlxdr) as ParsedOp;
      if (op.isDeposit()) {
        depositSum += op.getAmount();
        hasDeposit = true;
      } else if (op.isWithdraw()) {
        withdrawSum += op.getAmount();
        hasWithdraw = true;
      } else if (op.isCreate()) {
        createSum += op.getAmount();
        hasCreate = true;
      }
    } catch {
      // ignore unparseable ops for aggregation
    }
  }
  if (hasDeposit) return depositSum.toString();
  if (hasWithdraw) return withdrawSum.toString();
  if (hasCreate) return createSum.toString();
  return null;
}

function classify(op: ParsedOp): OpView {
  if (op.isDeposit()) {
    return {
      kind: "deposit",
      address: op.getPublicKey().toString(),
      amount: op.getAmount().toString(),
    };
  }
  if (op.isWithdraw()) {
    return {
      kind: "withdraw",
      address: op.getPublicKey().toString(),
      amount: op.getAmount().toString(),
    };
  }
  if (op.isSpend()) return { kind: "spend" };
  if (op.isCreate()) return { kind: "create" };
  return { kind: "unknown" };
}

/**
 * GET /api/v1/providers/:ppPublicKey/bundles/:id
 *
 * Returns one bundle with its decoded operations. The bundle MUST belong to
 * this PP; otherwise 404 (this closes the cross-PP leak that the unscoped
 * /dashboard/bundles/:id endpoint had).
 */
export function handleGetBundleDetail(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("getBundleDetail");

  return async (ctx) => {
    log.info("getBundleDetail");
    try {
      const params = (ctx as unknown as { params?: RouteParams }).params;
      const bundleId = params?.id;
      if (!bundleId) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = { message: "Bundle id is required" };
        return;
      }
      const pp = ctx.state.pp as PaymentProvider;
      log.debug("bundleId", bundleId);
      log.event("loading bundle");
      const bundle = await bundleRepo.findById(bundleId);
      if (!bundle || bundle.ppPublicKey !== pp.publicKey) {
        ctx.response.status = Status.NotFound;
        ctx.response.body = { message: "Bundle not found" };
        return;
      }
      const operations: OpView[] = [];
      for (const mlxdr of bundle.operationsMLXDR) {
        try {
          const op = MoonlightOperation.fromMLXDR(mlxdr);
          operations.push(classify(op));
        } catch (error) {
          log.error(error, "skipping unparseable operation MLXDR");
          operations.push({ kind: "unknown" });
        }
      }
      let entityName: string | null = null;
      let jurisdictions: string[] = [];
      if (bundle.createdBy) {
        log.event("loading submitter entity");
        const submitterAccount = await drizzleClient
          .select({ entityId: account.entityId })
          .from(account)
          .where(eq(account.id, bundle.createdBy))
          .limit(1);
        const entityId = submitterAccount[0]?.entityId;
        if (entityId) {
          const submitterEntity = await drizzleClient
            .select({ name: entity.name, jurisdictions: entity.jurisdictions })
            .from(entity)
            .where(eq(entity.id, entityId))
            .limit(1);
          if (submitterEntity[0]) {
            entityName = submitterEntity[0].name ?? null;
            jurisdictions = submitterEntity[0].jurisdictions ?? [];
          }
        }
      }
      ctx.response.status = Status.OK;
      ctx.response.body = {
        message: "Bundle detail",
        data: {
          id: bundle.id,
          status: bundle.status,
          channelContractId: bundle.channelContractId,
          operations,
          entityName,
          jurisdictions,
          amount: aggregateAmountFromMLXDR(bundle.operationsMLXDR),
        },
      };
      log.event("bundle detail response assembled");
    } catch (error) {
      log.error(error, "failed to fetch bundle detail");
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { message: "Failed to fetch bundle detail" };
    }
  };
}

/**
 * GET /api/v1/providers/:ppPublicKey/bundles?limit=N
 *
 * Provider-scoped recent-bundles list — returns every bundle submitted to
 * this PP in the last 6 hours regardless of submitter, joined to the
 * submitter entity for entityName + jurisdictions display. Operator JWT +
 * ownership check (the providers router applies requirePpOwnership before
 * this handler runs).
 *
 * Contrast with /providers/:ppPublicKey/entity/bundles which is the calling
 * entity's view of THEIR bundles to this PP, gated by an end-user JWT.
 */
export function handleListRecentBundles(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("listRecentBundles");

  return async (ctx) => {
    log.info("listRecentBundles");
    try {
      const pp = ctx.state.pp as PaymentProvider;

      const limitParam = ctx.request.url.searchParams.get("limit");
      const limit = limitParam
        ? Math.min(LIST_MAX_LIMIT, Math.max(1, Number(limitParam)))
        : LIST_DEFAULT_LIMIT;
      log.debug("limit", limit);

      const windowStart = new Date(Date.now() - LIST_WINDOW_MS);
      log.event("querying recent bundles for PP");
      const rows = await drizzleClient
        .select({
          id: operationsBundle.id,
          status: operationsBundle.status,
          channelContractId: operationsBundle.channelContractId,
          operationsMLXDR: operationsBundle.operationsMLXDR,
          createdAt: operationsBundle.createdAt,
          updatedAt: operationsBundle.updatedAt,
          entityName: entity.name,
          entityJurisdictions: entity.jurisdictions,
        })
        .from(operationsBundle)
        .leftJoin(account, eq(operationsBundle.createdBy, account.id))
        .leftJoin(entity, eq(account.entityId, entity.id))
        .where(
          and(
            isNull(operationsBundle.deletedAt),
            gte(operationsBundle.updatedAt, windowStart),
            eq(operationsBundle.ppPublicKey, pp.publicKey),
          ),
        )
        .orderBy(desc(operationsBundle.updatedAt))
        .limit(limit);

      log.debug("rowCount", rows.length);
      ctx.response.status = Status.OK;
      ctx.response.body = {
        message: "Recent bundles",
        data: {
          bundles: rows.map((r) => ({
            id: r.id,
            status: r.status,
            channelContractId: r.channelContractId,
            entityName: r.entityName,
            jurisdictions: r.entityJurisdictions ?? [],
            amount: aggregateAmountFromMLXDR(r.operationsMLXDR),
            createdAt: r.createdAt instanceof Date
              ? r.createdAt.toISOString()
              : r.createdAt,
            updatedAt: r.updatedAt instanceof Date
              ? r.updatedAt.toISOString()
              : r.updatedAt,
          })),
        },
      };
      log.event("recent bundles response assembled");
    } catch (error) {
      log.error(error, "failed to list bundles");
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { message: "Failed to list bundles" };
    }
  };
}
