/**
 * Slot-failure isolation.
 *
 * A slot batches multiple users' bundles into one transaction, and the whole
 * batch fails together — so one unexecutable bundle used to terminal-fail
 * every innocent bundle batched with it. This module probes each bundle of a
 * failed slot on its own (build + auth-free simulation, nothing is submitted
 * on-chain) to tell offenders from innocents: offenders are terminal-FAILED
 * with their own failure identity, innocents go back to the mempool and are
 * re-batched by the normal slot-formation path.
 *
 * Slot formation itself is untouched: bundles are only probed after a slot
 * has already failed, and the probe is a local dry-run, so the privacy
 * property that a slot batches multiple users' operations stays intact.
 */
import {
  decodeContractError,
  MoonlightError,
  type MoonlightTransactionBuilder,
} from "@moonlight/moonlight-sdk";
import {
  Account as StellarAccount,
  Operation,
  TransactionBuilder,
} from "stellar-sdk";
import { Api as RpcApi, type Server } from "stellar-sdk/rpc";
import type { Logger } from "@/utils/logger/index.ts";
import { withSpan } from "@/core/tracing.ts";
import { BundleStatus } from "@/persistence/drizzle/entity/operations-bundle.entity.ts";
import type { OperationsBundleRepository } from "@/persistence/drizzle/repository/operations-bundle.repository.ts";
import type { SlotBundle } from "@/core/service/bundle/bundle.types.ts";
import type { ChannelContext } from "@/core/service/executor/channel-resolver.ts";
import { buildTransactionFromBundles } from "@/core/service/executor/executor.service.ts";
import { buildFailureDetail } from "@/core/service/executor/failure-detail.ts";
import { safeJsonStringify } from "@/utils/parse/safeStringify.ts";

/**
 * `invalid` — the bundle itself cannot execute (build rejected it or the
 * simulation failed); `valid` — the bundle builds and simulates cleanly on
 * its own; `inconclusive` — the probe could not decide (e.g. an RPC
 * transport error), so no verdict may be based on it.
 */
export type BundleProbeVerdict = "valid" | "invalid" | "inconclusive";

export type BundleProbeResult = {
  bundleId: string;
  verdict: BundleProbeVerdict;
  error?: Error;
};

/**
 * Classifies an error thrown while building a single-bundle transaction.
 * Only errors that identify the bundle's own content as unexecutable count
 * as `invalid`: decoded on-chain contract reverts, and the SDK's
 * operation/transaction-builder validation errors (OPR_* / TBU_*, e.g. the
 * negative-fee `AMOUNT_TOO_LOW`). Anything else — OPEX UTXO handling,
 * network reads — is not the bundle's fault and stays `inconclusive`.
 */
export function classifyProbeBuildError(
  error: unknown,
): Extract<BundleProbeVerdict, "invalid" | "inconclusive"> {
  if (decodeContractError(error) !== null) return "invalid";
  if (error instanceof MoonlightError) {
    const code = (error as { code?: string }).code ?? "";
    if (code.startsWith("OPR_") || code.startsWith("TBU_")) return "invalid";
  }
  return "inconclusive";
}

/**
 * Probes a single bundle: builds a solo transaction for it and runs an
 * auth-free `simulateTransaction` (same shape as the pre-flight OpEx sim —
 * Soroban does not need auth entries or a live sequence number to evaluate
 * the invocation). Nothing is signed and nothing reaches the ledger.
 */
export function probeBundle(
  bundle: SlotBundle,
  ctx: ChannelContext,
  deps: {
    rpcServer: Pick<Server, "simulateTransaction">;
    networkPassphrase: string;
    baseInclusionFeeStroops: bigint;
    feePayerPubkey: string;
    log: Logger;
  },
): Promise<BundleProbeResult> {
  return withSpan("Executor.probeBundle", async (span) => {
    span.setAttribute("bundle.id", bundle.bundleId);
    const log = deps.log.scope("probeBundle");
    log.info("probeBundle");
    log.debug("bundleId", bundle.bundleId);

    let txBuilder: MoonlightTransactionBuilder;
    try {
      ({ txBuilder } = await buildTransactionFromBundles([bundle], ctx, {
        log,
      }));
    } catch (error) {
      const verdict = classifyProbeBuildError(error);
      span.addEvent("probe_build_failed", { verdict });
      log.event(`solo build failed, verdict ${verdict}`);
      return {
        bundleId: bundle.bundleId,
        verdict,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }

    try {
      const sourceAccount = new StellarAccount(deps.feePayerPubkey, "0");
      const invokeOp = Operation.invokeContractFunction({
        contract: txBuilder.getChannelId(),
        function: "transact",
        args: [txBuilder.buildXDR()],
        auth: [],
      });
      const tx = new TransactionBuilder(sourceAccount, {
        fee: deps.baseInclusionFeeStroops.toString(),
        networkPassphrase: deps.networkPassphrase,
      })
        .addOperation(invokeOp)
        .setTimeout(30)
        .build();

      const sim = await deps.rpcServer.simulateTransaction(tx);
      if (RpcApi.isSimulationError(sim)) {
        span.addEvent("probe_simulation_rejected");
        log.event("solo simulation rejected, verdict invalid");
        return {
          bundleId: bundle.bundleId,
          verdict: "invalid",
          error: new Error(sim.error),
        };
      }
      span.addEvent("probe_ok");
      return { bundleId: bundle.bundleId, verdict: "valid" };
    } catch (error) {
      // A thrown (as opposed to returned) simulation failure is transport or
      // encoding trouble — not evidence against the bundle.
      span.addEvent("probe_inconclusive");
      log.error(error, "probe simulation errored, verdict inconclusive");
      return {
        bundleId: bundle.bundleId,
        verdict: "inconclusive",
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  });
}

/**
 * Handles a failed multi-bundle slot by isolating the offending bundle(s).
 *
 * Returns `true` when isolation handled the failure (offenders FAILED,
 * innocents re-queued) and `false` when the caller must fall back to the
 * group retry path: fewer than two bundles, any inconclusive probe, or no
 * offender found (the failure was not attributable to a single bundle —
 * e.g. transient, or a cross-bundle conflict no solo probe can see).
 *
 * Innocents keep their retryCount: they did not fail on their own, and
 * charging them a retry would let repeated poisoning by unrelated bad
 * bundles dead-letter honest work.
 */
export function handleSlotFailureWithIsolation(
  bundles: SlotBundle[],
  deps: {
    probe: (bundle: SlotBundle) => Promise<BundleProbeResult>;
    operationsBundleRepository: OperationsBundleRepository;
    reAddBundles: (bundles: SlotBundle[]) => Promise<void>;
    log: Logger;
  },
): Promise<boolean> {
  return withSpan("Executor.handleSlotFailureWithIsolation", async (span) => {
    const log = deps.log.scope("handleSlotFailureWithIsolation");
    log.info("handleSlotFailureWithIsolation");
    log.debug("bundleCount", bundles.length);

    if (bundles.length < 2) {
      span.addEvent("isolation_skipped_single_bundle");
      return false;
    }

    const results: BundleProbeResult[] = [];
    for (const bundle of bundles) {
      results.push(await deps.probe(bundle));
    }

    if (results.some((r) => r.verdict === "inconclusive")) {
      span.addEvent("isolation_inconclusive");
      log.event("probe inconclusive for at least one bundle, falling back");
      return false;
    }

    const offenders = results.filter((r) => r.verdict === "invalid");
    if (offenders.length === 0) {
      span.addEvent("isolation_no_offender");
      log.event("no offending bundle identified, falling back");
      return false;
    }

    span.addEvent("isolation_verdict", {
      "offenders.count": offenders.length,
      "innocents.count": results.length - offenders.length,
    });

    for (const offender of offenders) {
      const error = offender.error ?? new Error("bundle probe rejected");
      const failureDetail = { ...buildFailureDetail(error) };
      const lastFailureReason = safeJsonStringify({
        occurredAt: new Date().toISOString(),
        phase: "bundleIsolation",
        error: { name: error.name, message: error.message },
        bundleIds: [offender.bundleId],
      }) ?? error.message;

      try {
        const bundle = await deps.operationsBundleRepository.findById(
          offender.bundleId,
        );
        const nextRetryCount = (bundle?.retryCount ?? 0) + 1;
        const updated = await deps.operationsBundleRepository.updateIfStatusIn(
          offender.bundleId,
          {
            status: BundleStatus.FAILED,
            retryCount: nextRetryCount,
            lastFailureReason,
            failureDetail,
          },
          [BundleStatus.PENDING, BundleStatus.PROCESSING],
        );
        log.debug("bundleId", offender.bundleId);
        log.event(
          updated
            ? "offending bundle terminal-FAILED by isolation"
            : "offending bundle already terminal, left untouched",
        );
      } catch (persistError) {
        span.addEvent("isolation_persist_failed", {
          "bundle.id": offender.bundleId,
        });
        log.error(persistError, "failed to persist FAILED for offender");
      }
    }

    const offenderIds = new Set(offenders.map((o) => o.bundleId));
    const innocents = bundles.filter((b) => !offenderIds.has(b.bundleId));
    const requeue: SlotBundle[] = [];
    for (const innocent of innocents) {
      try {
        const updated = await deps.operationsBundleRepository.updateIfStatusIn(
          innocent.bundleId,
          { status: BundleStatus.PENDING },
          [BundleStatus.PENDING, BundleStatus.PROCESSING],
        );
        if (updated) requeue.push(innocent);
        else {
          log.debug("bundleId", innocent.bundleId);
          log.event("innocent bundle already terminal, not re-queued");
        }
      } catch (persistError) {
        span.addEvent("isolation_persist_failed", {
          "bundle.id": innocent.bundleId,
        });
        log.error(persistError, "failed to reset innocent bundle to PENDING");
      }
    }

    if (requeue.length > 0) {
      await deps.reAddBundles(requeue);
      log.event("innocent bundles re-added to mempool after isolation");
    }

    return true;
  });
}
