import { type Context, Status } from "@oak/oak";
import { and, between, desc, eq, isNull } from "drizzle-orm";
import { MoonlightOperation } from "@moonlight/moonlight-sdk";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { PpRepository } from "@/persistence/drizzle/repository/pp.repository.ts";
import { TransactionRepository } from "@/persistence/drizzle/repository/transaction.repository.ts";
import { BundleTransactionRepository } from "@/persistence/drizzle/repository/bundle-transaction.repository.ts";
import { OperationsBundleRepository } from "@/persistence/drizzle/repository/operations-bundle.repository.ts";
import { UtxoRepository } from "@/persistence/drizzle/repository/utxo.repository.ts";
import { transaction } from "@/persistence/drizzle/entity/transaction.entity.ts";
import { operationsBundle } from "@/persistence/drizzle/entity/operations-bundle.entity.ts";
import { bundleTransaction } from "@/persistence/drizzle/entity/bundle-transaction.entity.ts";
import type { Logger } from "@/utils/logger/index.ts";

const ppRepo = new PpRepository(drizzleClient);
const txRepo = new TransactionRepository();
const bundleTxRepo = new BundleTransactionRepository();
const bundleRepo = new OperationsBundleRepository(drizzleClient);
const utxoRepo = new UtxoRepository(drizzleClient);

const MAX_LIST_RESULTS = 500;

type ParsedOps = {
  deposits: Array<{ depositorAddress: string; amount: string }>;
  withdraws: Array<{ recipientAddress: string; amount: string }>;
  spendCount: number;
  createCount: number;
};

function parseBundleOps(operationsMLXDR: string[], log: Logger): ParsedOps {
  const deposits: ParsedOps["deposits"] = [];
  const withdraws: ParsedOps["withdraws"] = [];
  let spendCount = 0;
  let createCount = 0;
  for (const mlxdr of operationsMLXDR) {
    try {
      const op = MoonlightOperation.fromMLXDR(mlxdr);
      if (op.isDeposit()) {
        deposits.push({
          depositorAddress: op.getPublicKey().toString(),
          amount: op.getAmount().toString(),
        });
      } else if (op.isWithdraw()) {
        withdraws.push({
          recipientAddress: op.getPublicKey().toString(),
          amount: op.getAmount().toString(),
        });
      } else if (op.isSpend()) {
        spendCount++;
      } else if (op.isCreate()) {
        createCount++;
      }
    } catch (error) {
      log.error(error, "skipping unparseable operation MLXDR");
    }
  }
  return { deposits, withdraws, spendCount, createCount };
}

async function buildTxDetail(txId: string, log: Logger) {
  log.info("buildTxDetail");
  log.debug("txId", txId);
  log.event("loading transaction");
  const tx = await txRepo.findById(txId);
  if (!tx) return null;

  log.event("aggregating bundle/utxo details");

  const bundleLinks = await bundleTxRepo.findByTransactionId(txId);
  const bundles = [];
  let earliestBundleCreatedAt: Date | null = null;
  let channelContractId: string | null = null;
  const aggregatedDeposits: Array<
    { depositorAddress: string; amount: string }
  > = [];
  const aggregatedWithdraws: Array<
    { recipientAddress: string; amount: string }
  > = [];

  for (const link of bundleLinks) {
    const bundle = await bundleRepo.findById(link.bundleId);
    if (!bundle) continue;
    if (!channelContractId && bundle.channelContractId) {
      channelContractId = bundle.channelContractId;
    }
    if (
      !earliestBundleCreatedAt || bundle.createdAt < earliestBundleCreatedAt
    ) {
      earliestBundleCreatedAt = bundle.createdAt;
    }
    const ops = parseBundleOps(bundle.operationsMLXDR, log);
    aggregatedDeposits.push(...ops.deposits);
    aggregatedWithdraws.push(...ops.withdraws);
    bundles.push({
      id: bundle.id,
      createdAt: bundle.createdAt.toISOString(),
      deposits: ops.deposits,
      withdraws: ops.withdraws,
      spendCount: ops.spendCount,
      createCount: ops.createCount,
    });
  }

  const utxos = [];
  for (const link of bundleLinks) {
    const created = await utxoRepo.findByCreatedAtBundleId(link.bundleId);
    for (const u of created) {
      utxos.push({
        id: u.id,
        amount: u.amount.toString(),
        createdAtBundleId: u.createdAtBundleId,
        spent: u.spentAtBundleId !== null,
      });
    }
  }

  const isVerified = tx.status === "VERIFIED";

  return {
    id: tx.id,
    status: tx.status,
    ledgerSequence: tx.ledgerSequence,
    channelContractId,
    timeline: {
      mempoolAt: earliestBundleCreatedAt?.toISOString() ?? null,
      submittedAt: tx.createdAt.toISOString(),
      verifiedAt: isVerified ? tx.updatedAt.toISOString() : null,
    },
    senders: aggregatedDeposits.map((d) => d.depositorAddress),
    receivers: aggregatedWithdraws.map((w) => w.recipientAddress),
    deposits: aggregatedDeposits,
    withdraws: aggregatedWithdraws,
    bundles,
    utxos,
  };
}

async function findTxIdsInRange(
  channelContractId: string,
  from: Date,
  to: Date,
  limit: number,
  log: Logger,
): Promise<string[]> {
  log.info("findTxIdsInRange");
  log.debug("channelContractId", channelContractId);
  log.debug("limit", limit);
  log.event("querying transactions by channel + time range");
  const rows = await drizzleClient
    .selectDistinct({ id: transaction.id, createdAt: transaction.createdAt })
    .from(transaction)
    .innerJoin(
      bundleTransaction,
      eq(bundleTransaction.transactionId, transaction.id),
    )
    .innerJoin(
      operationsBundle,
      eq(operationsBundle.id, bundleTransaction.bundleId),
    )
    .where(
      and(
        eq(operationsBundle.channelContractId, channelContractId),
        between(transaction.createdAt, from, to),
        isNull(transaction.deletedAt),
      ),
    )
    .orderBy(desc(transaction.createdAt))
    .limit(limit);
  return rows.map((r) => r.id);
}

type RouteParams = { id?: string };

export function handleListDashboardTransactions(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("listDashboardTransactions");

  return async (ctx) => {
    log.info("listDashboardTransactions");
    try {
      const ppPublicKey = ctx.request.url.searchParams.get("ppPublicKey");
      const channelContractId = ctx.request.url.searchParams.get(
        "channelContractId",
      );
      const fromIso = ctx.request.url.searchParams.get("fromIso");
      const toIso = ctx.request.url.searchParams.get("toIso");

      if (!ppPublicKey || !channelContractId || !fromIso || !toIso) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = {
          message: "ppPublicKey, channelContractId, fromIso, toIso required",
        };
        return;
      }

      const from = new Date(fromIso);
      const to = new Date(toIso);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = { message: "fromIso/toIso must be ISO datetimes" };
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

      const txIds = await findTxIdsInRange(
        channelContractId,
        from,
        to,
        MAX_LIST_RESULTS,
        log,
      );

      const items = [];
      for (const txId of txIds) {
        const detail = await buildTxDetail(txId, log);
        if (detail) items.push(detail);
      }

      ctx.response.status = Status.OK;
      ctx.response.body = {
        message: "Transactions retrieved",
        data: items,
        truncated: txIds.length >= MAX_LIST_RESULTS,
      };
    } catch (error) {
      log.error(error, "failed to list transactions");
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { message: "Failed to list transactions" };
    }
  };
}

export function handleGetTransactionDetail(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("getTransactionDetail");

  return async (ctx) => {
    log.info("getTransactionDetail");
    try {
      const params = (ctx as unknown as { params?: RouteParams }).params;
      const txId = params?.id;
      if (!txId) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = { message: "Transaction id is required" };
        return;
      }

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

      const detail = await buildTxDetail(txId, log);
      if (!detail) {
        ctx.response.status = Status.NotFound;
        ctx.response.body = { message: "Transaction not found" };
        return;
      }

      ctx.response.status = Status.OK;
      ctx.response.body = { message: "Transaction detail", data: detail };
    } catch (error) {
      log.error(error, "failed to fetch transaction detail");
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { message: "Failed to fetch transaction detail" };
    }
  };
}
