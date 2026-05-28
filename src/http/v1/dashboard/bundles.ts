import { type Context, Status } from "@oak/oak";
import { and, desc, eq, gte, isNull } from "drizzle-orm";
import {
  MoonlightOperation,
  type OperationTypes,
} from "@moonlight/moonlight-sdk";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { OperationsBundleRepository } from "@/persistence/drizzle/repository/operations-bundle.repository.ts";
import { PpRepository } from "@/persistence/drizzle/repository/pp.repository.ts";
import { operationsBundle } from "@/persistence/drizzle/entity/operations-bundle.entity.ts";
import { account } from "@/persistence/drizzle/entity/account.entity.ts";
import { entity } from "@/persistence/drizzle/entity/entity.entity.ts";
import { LOG } from "@/config/logger.ts";

const bundleRepo = new OperationsBundleRepository(drizzleClient);
const ppRepo = new PpRepository(drizzleClient);
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
        // For Send bundles, sum of create-outputs ≈ amount moved.
        // (SpendOperation intentionally has no amount — UTXO ref only.)
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
 * GET /dashboard/bundles/:id
 *
 * Returns one bundle with its decoded operations (kind + addr/amount for
 * deposit/withdraw). Used by the provider-console preview table to expand
 * a row and show what's inside the bundle.
 */
export const getBundleDetailHandler = async (ctx: Context) => {
  try {
    const params = (ctx as unknown as { params?: RouteParams }).params;
    const bundleId = params?.id;
    if (!bundleId) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "Bundle id is required" };
      return;
    }
    const bundle = await bundleRepo.findById(bundleId);
    if (!bundle) {
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
        LOG.warn("Skipping unparseable operation MLXDR", {
          error: error instanceof Error ? error.message : String(error),
        });
        operations.push({ kind: "unknown" });
      }
    }
    let entityName: string | null = null;
    let jurisdictions: string[] = [];
    if (bundle.createdBy) {
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
  } catch (error) {
    LOG.error("Failed to fetch bundle detail", {
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to fetch bundle detail" };
  }
};

/**
 * GET /dashboard/bundles?limit=N
 *
 * Returns most-recent bundles (by updatedAt desc) so the dashboard can
 * populate the recent-bundles table on initial load instead of waiting
 * for new events to stream in.
 */
export const listRecentBundlesHandler = async (ctx: Context) => {
  try {
    const ppPublicKey = ctx.request.url.searchParams.get("ppPublicKey");
    if (!ppPublicKey) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = {
        message: "ppPublicKey query parameter is required",
      };
      return;
    }
    const ownerPublicKey = (ctx.state.session as { sub: string }).sub;
    const pp = await ppRepo.findByPublicKeyAndOwner(
      ppPublicKey,
      ownerPublicKey,
    );
    if (!pp) {
      ctx.response.status = Status.NotFound;
      ctx.response.body = { message: "Provider not found" };
      return;
    }

    const limitParam = ctx.request.url.searchParams.get("limit");
    const limit = limitParam
      ? Math.min(LIST_MAX_LIMIT, Math.max(1, Number(limitParam)))
      : LIST_DEFAULT_LIMIT;

    const windowStart = new Date(Date.now() - LIST_WINDOW_MS);
    // URL-scoped bundles: each bundle row carries pp_public_key. A PP only
    // sees its own traffic — every status, including FAILED and EXPIRED.
    // No cross-PP visibility.
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
          eq(operationsBundle.ppPublicKey, ppPublicKey),
        ),
      )
      .orderBy(desc(operationsBundle.updatedAt))
      .limit(limit);

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
  } catch (error) {
    LOG.error("Failed to list bundles", {
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to list bundles" };
  }
};
