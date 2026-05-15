import { type Context, Status } from "@oak/oak";
import { MoonlightOperation } from "@moonlight/moonlight-sdk";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { PpRepository } from "@/persistence/drizzle/repository/pp.repository.ts";
import { TransactionRepository } from "@/persistence/drizzle/repository/transaction.repository.ts";
import { BundleTransactionRepository } from "@/persistence/drizzle/repository/bundle-transaction.repository.ts";
import { OperationsBundleRepository } from "@/persistence/drizzle/repository/operations-bundle.repository.ts";
import { UtxoRepository } from "@/persistence/drizzle/repository/utxo.repository.ts";
import { LOG } from "@/config/logger.ts";

const ppRepo = new PpRepository(drizzleClient);
const txRepo = new TransactionRepository();
const bundleTxRepo = new BundleTransactionRepository();
const bundleRepo = new OperationsBundleRepository(drizzleClient);
const utxoRepo = new UtxoRepository(drizzleClient);

type ParsedOps = {
  deposits: Array<{ depositorAddress: string; amount: string }>;
  withdraws: Array<{ recipientAddress: string; amount: string }>;
  spendCount: number;
  createCount: number;
};

function parseBundleOps(operationsMLXDR: string[]): ParsedOps {
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
      LOG.warn("Skipping unparseable operation MLXDR", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { deposits, withdraws, spendCount, createCount };
}

type RouteParams = { id?: string };

/**
 * GET /dashboard/transactions/:id?ppPublicKey=G...
 *
 * Returns the full lifecycle picture of one tx: timeline, bundles with
 * parsed deposit/withdraw addresses, jurisdictions, and the UTXOs the tx
 * created. Parsing of operations_mlxdr happens at request time — no extra
 * persistence is required on the write path.
 */
export const getTransactionDetailHandler = async (ctx: Context) => {
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
      ctx.response.body = { message: "ppPublicKey query parameter is required" };
      return;
    }

    const ownerPublicKey = (ctx.state.session as { sub: string }).sub;
    const pp = await ppRepo.findByPublicKeyAndOwner(ppPublicKey, ownerPublicKey);
    if (!pp) {
      ctx.response.status = Status.NotFound;
      ctx.response.body = { message: "Provider not found" };
      return;
    }

    const tx = await txRepo.findById(txId);
    if (!tx) {
      ctx.response.status = Status.NotFound;
      ctx.response.body = { message: "Transaction not found" };
      return;
    }

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
    const jurisdictionsFrom = new Set<string>();
    const jurisdictionsTo = new Set<string>();

    for (const link of bundleLinks) {
      const bundle = await bundleRepo.findById(link.bundleId);
      if (!bundle) continue;
      if (!channelContractId && bundle.channelContractId) {
        channelContractId = bundle.channelContractId;
      }
      if (!earliestBundleCreatedAt || bundle.createdAt < earliestBundleCreatedAt) {
        earliestBundleCreatedAt = bundle.createdAt;
      }
      const ops = parseBundleOps(bundle.operationsMLXDR);
      aggregatedDeposits.push(...ops.deposits);
      aggregatedWithdraws.push(...ops.withdraws);
      if (bundle.jurisdictionFrom) jurisdictionsFrom.add(bundle.jurisdictionFrom);
      if (bundle.jurisdictionTo) jurisdictionsTo.add(bundle.jurisdictionTo);
      bundles.push({
        id: bundle.id,
        createdAt: bundle.createdAt.toISOString(),
        jurisdictionFrom: bundle.jurisdictionFrom,
        jurisdictionTo: bundle.jurisdictionTo,
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

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Transaction detail",
      data: {
        id: tx.id,
        status: tx.status,
        ledgerSequence: tx.ledgerSequence,
        channelContractId,
        timeline: {
          mempoolAt: earliestBundleCreatedAt?.toISOString() ?? null,
          submittedAt: tx.createdAt.toISOString(),
          verifiedAt: isVerified ? tx.updatedAt.toISOString() : null,
        },
        jurisdictions: {
          from: Array.from(jurisdictionsFrom),
          to: Array.from(jurisdictionsTo),
        },
        senders: aggregatedDeposits.map((d) => d.depositorAddress),
        receivers: aggregatedWithdraws.map((w) => w.recipientAddress),
        deposits: aggregatedDeposits,
        withdraws: aggregatedWithdraws,
        bundles,
        utxos,
      },
    };
  } catch (error) {
    LOG.error("Failed to fetch transaction detail", {
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to fetch transaction detail" };
  }
};
