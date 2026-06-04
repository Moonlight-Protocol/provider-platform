import { ProcessEngine } from "@fifo/convee";
import { Buffer } from "buffer";
import type { JwtSessionData } from "@/http/middleware/auth/index.ts";
import { BundleStatus } from "@/persistence/drizzle/entity/operations-bundle.entity.ts";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import type { requestSchema } from "@/http/v1/bundle/post.ts";
import type { PostEndpointInput } from "@/http/pipelines/types.ts";
import type { OperationTypes } from "@moonlight/moonlight-sdk";
import { MoonlightOperation } from "@moonlight/moonlight-sdk";
import { resolveChannelContext } from "@/core/service/executor/channel-resolver.ts";
import {
  calculateBundleTtl,
  calculateBundleWeight,
  calculateFee,
  calculateOperationAmounts,
  calculatePriorityScore,
  classifyOperations,
  fetchUtxoBalances,
  generateBundleId,
} from "@/core/service/bundle/bundle.service.ts";
import {
  BUNDLE_MAX_OPERATIONS,
  MEMPOOL_CHEAP_OP_WEIGHT,
  MEMPOOL_EXPENSIVE_OP_WEIGHT,
} from "@/config/env.ts";
import type {
  SlotBundle,
  WeightConfig,
} from "@/core/service/bundle/bundle.types.ts";
import { getMempool } from "@/core/mempool/index.ts";
import * as E from "@/core/service/bundle/bundle.errors.ts";
import type { ClassifiedOperations } from "@/core/service/bundle/bundle.types.ts";
import type { OperationsBundle } from "@/persistence/drizzle/entity/operations-bundle.entity.ts";
import {
  AccountRepository,
  EntityRepository,
  OperationsBundleRepository,
  SessionRepository,
  UtxoRepository,
} from "@/persistence/drizzle/repository/index.ts";
import { PpEntityApprovalRepository } from "@/persistence/drizzle/repository/pp-entity-approval.repository.ts";
import { EntityStatus } from "@/persistence/drizzle/entity/index.ts";
import { withSpan } from "@/core/tracing.ts";
import type { Logger } from "@/utils/logger/index.ts";

const sessionRepository = new SessionRepository(drizzleClient);
const accountRepository = new AccountRepository(drizzleClient);
const entityRepository = new EntityRepository(drizzleClient);
const ppApprovalRepository = new PpEntityApprovalRepository(drizzleClient);
const utxoRepository = new UtxoRepository(drizzleClient);
const operationsBundleRepository = new OperationsBundleRepository(
  drizzleClient,
);

const MEMPOOL_WEIGHT_CONFIG: WeightConfig = {
  expensiveOpWeight: MEMPOOL_EXPENSIVE_OP_WEIGHT,
  cheapOpWeight: MEMPOOL_CHEAP_OP_WEIGHT,
} as const;

function validateSession(sessionId: string, deps: { log: Logger }) {
  return withSpan("Bundle.validateSession", async (span) => {
    const log = deps.log.scope("validateSession");
    log.info("validateSession");
    log.debug("sessionId", sessionId);

    span.addEvent("looking_up_session", { "session.id": sessionId });
    log.event("looking up session");
    const userSession = await sessionRepository.findById(sessionId);
    if (!userSession) {
      span.addEvent("session_not_found");
      log.event("session not found");
      throw new E.INVALID_SESSION(sessionId);
    }
    span.addEvent("session_valid", { "account.id": userSession.accountId });
    log.event("session valid");
    return userSession;
  });
}

function assertBundleIsExpired(
  bundleId: string,
  deps: { log: Logger },
): Promise<boolean> {
  return withSpan("Bundle.assertBundleIsExpired", async (span) => {
    const log = deps.log.scope("assertBundleIsExpired");
    log.info("assertBundleIsExpired");
    log.debug("bundleId", bundleId);

    span.addEvent("checking_existing_bundle", { "bundle.id": bundleId });
    log.event("checking for existing bundle");
    const existingBundle = await operationsBundleRepository.findById(bundleId);

    if (!existingBundle) {
      span.addEvent("bundle_not_found");
      log.event("no existing bundle");
      return false;
    }

    if (
      existingBundle.status !== BundleStatus.EXPIRED &&
      existingBundle.status !== BundleStatus.FAILED
    ) {
      span.addEvent("bundle_exists_not_expired", {
        "bundle.status": existingBundle.status,
      });
      log.event("bundle exists and is active");
      throw new E.BUNDLE_ALREADY_EXISTS(bundleId);
    }

    span.addEvent("bundle_can_be_reused", {
      "bundle.status": existingBundle.status,
    });
    log.event("bundle is expired or failed, may be reused");
    return true;
  });
}

function parseOperations(
  operationsMLXDR: string[],
  deps: { log: Logger },
): Promise<
  Array<
    | OperationTypes.CreateOperation
    | OperationTypes.SpendOperation
    | OperationTypes.DepositOperation
    | OperationTypes.WithdrawOperation
  >
> {
  return withSpan("Bundle.parseOperations", async (span) => {
    const log = deps.log.scope("parseOperations");
    log.info("parseOperations");
    log.debug("operationCount", operationsMLXDR.length);

    span.addEvent("parsing_operations", {
      "operations.count": operationsMLXDR.length,
    });
    log.event("parsing MLXDR operations");
    const operations = await Promise.all(
      operationsMLXDR.map((xdr) => MoonlightOperation.fromMLXDR(xdr)),
    );

    if (operations.length === 0) {
      span.addEvent("no_operations");
      log.event("no operations parsed");
      throw new E.NO_OPERATIONS_PROVIDED();
    }

    span.addEvent("operations_parsed", {
      "operations.count": operations.length,
    });
    log.event("operations parsed");
    return operations;
  });
}

function validateSpendOperations(
  operations: OperationTypes.SpendOperation[],
): void {
  for (let i = 0; i < operations.length; i++) {
    const operation = operations[i];
    if (!operation.isSignedByUTXO()) {
      throw new E.SPEND_OPERATION_NOT_SIGNED(i);
    }
  }
}

function persistCreateOperations(
  operations: OperationTypes.CreateOperation[],
  bundleId: string,
  accountId: string,
  deps: { log: Logger },
): Promise<void> {
  return withSpan("Bundle.persistCreateOperations", async (span) => {
    const log = deps.log.scope("persistCreateOperations");
    log.info("persistCreateOperations");
    log.debug("operationCount", operations.length);
    log.debug("bundleId", bundleId);

    span.addEvent("persisting_create_utxos", {
      "operations.count": operations.length,
      "bundle.id": bundleId,
    });
    log.event("persisting CREATE UTXOs");
    for (const operation of operations) {
      const utxoId = Buffer.from(operation.getUtxo()).toString("base64");
      const utxo = await utxoRepository.findById(utxoId);
      if (utxo) {
        span.addEvent("utxo_already_exists", { "utxo.id": utxoId });
        continue;
      }

      await utxoRepository.create({
        id: utxoId,
        accountId,
        amount: operation.getAmount(),
        createdAt: new Date(),
        createdBy: accountId,
        createdAtBundleId: bundleId,
      });
    }
    span.addEvent("create_utxos_persisted");
    log.event("CREATE UTXOs persisted");
  });
}

function persistSpendOperations(
  operations: OperationTypes.SpendOperation[],
  bundleId: string,
  accountId: string,
  channelClient: import("@moonlight/moonlight-sdk").PrivacyChannel,
  deps: { log: Logger },
): Promise<void> {
  if (operations.length === 0) {
    return Promise.resolve();
  }

  return withSpan("Bundle.persistSpendOperations", async (span) => {
    span.addEvent("persisting_spend_utxos", {
      "operations.count": operations.length,
      "bundle.id": bundleId,
    });

    const utxoPublicKeys = operations.map((op) => op.getUtxo());
    const balances = await fetchUtxoBalances(
      utxoPublicKeys,
      channelClient,
      deps,
    );

    for (let i = 0; i < operations.length; i++) {
      const operation = operations[i];
      const utxoPublicKey = operation.getUtxo();
      const utxoId = Buffer.from(utxoPublicKey).toString("base64");

      const utxo = await utxoRepository.findById(utxoId);
      if (!utxo) {
        span.addEvent("utxo_not_found", { "utxo.id": utxoId });
        throw new E.UTXO_NOT_FOUND(utxoId);
      }

      const spendAmount = balances[i] || BigInt(0);

      await utxoRepository.update(utxo.id, {
        amount: utxo.amount - spendAmount,
        updatedAt: new Date(),
        updatedBy: accountId,
        spentAtBundleId: bundleId,
        spentByAccountId: accountId,
      });
    }

    span.addEvent("spend_utxos_persisted");
  });
}

function aggregateBundleAmount(
  classified: ClassifiedOperations,
): string | null {
  const sum = (
    list: Array<{ getAmount: () => bigint }>,
  ): bigint => list.reduce((acc, op) => acc + op.getAmount(), 0n);
  if (classified.deposit.length > 0) return sum(classified.deposit).toString();
  if (classified.withdraw.length > 0) {
    return sum(classified.withdraw).toString();
  }
  if (classified.create.length > 0) return sum(classified.create).toString();
  return null;
}

function createSlotBundle(
  bundleEntity: OperationsBundle,
  classified: ClassifiedOperations,
  entityName: string | null,
  jurisdictions: string[],
): SlotBundle {
  const weight = calculateBundleWeight(classified, MEMPOOL_WEIGHT_CONFIG);
  const priorityScore = calculatePriorityScore({
    fee: bundleEntity.fee,
    ttl: bundleEntity.ttl,
    createdAt: bundleEntity.createdAt,
  });

  return {
    bundleId: bundleEntity.id,
    channelContractId: bundleEntity.channelContractId ?? "",
    operationsMLXDR: bundleEntity.operationsMLXDR,
    operations: classified,
    fee: bundleEntity.fee,
    weight,
    ttl: bundleEntity.ttl,
    createdAt: bundleEntity.createdAt,
    priorityScore,
    retryCount: bundleEntity.retryCount ?? 0,
    lastFailureReason: bundleEntity.lastFailureReason ?? null,
    ppPublicKey: bundleEntity.ppPublicKey ?? "",
    entityName,
    jurisdictions,
    amount: aggregateBundleAmount(classified),
  };
}

// ========== MAIN PROCESS ==========

export const P_AddOperationsBundle = (deps: { log: Logger }) =>
  ProcessEngine.create(
    (input: PostEndpointInput<typeof requestSchema>) => {
      return withSpan("P_AddOperationsBundle", async (span) => {
        const log = deps.log.scope("P_AddOperationsBundle");
        log.info("P_AddOperationsBundle");

        const { operationsMLXDR, channelContractId } = input.body;
        log.debug("operationCount", operationsMLXDR.length);
        log.debug("channelContractId", channelContractId);

        if (operationsMLXDR.length > BUNDLE_MAX_OPERATIONS) {
          throw new E.TOO_MANY_OPERATIONS(
            operationsMLXDR.length,
            BUNDLE_MAX_OPERATIONS,
          );
        }
        const sessionData = input.ctx.state.session as JwtSessionData;

        const params = (input.ctx as unknown as {
          params?: { ppPublicKey?: string };
        }).params;
        const ppPublicKey = params?.ppPublicKey;
        if (!ppPublicKey) {
          throw new E.PP_PUBLIC_KEY_REQUIRED();
        }
        span.setAttribute("pp.publicKey", ppPublicKey);
        log.debug("ppPublicKey", ppPublicKey);

        log.event("resolving channel context for PP");
        const channelCtx = await resolveChannelContext(
          channelContractId,
          ppPublicKey,
          deps,
        );
        const channelClient = channelCtx.channelClient;

        span.addEvent("validating_session");
        log.event("validating session");
        const userSession = await validateSession(sessionData.sessionId, deps);

        span.addEvent("validating_entity_approval", {
          "account.id": userSession.accountId,
          "pp.public_key": ppPublicKey,
        });
        log.event("validating per-PP entity approval");
        const submitterAccount = await accountRepository.findById(
          userSession.accountId,
        );
        if (!submitterAccount) {
          log.event("submitter has no account; reject");
          throw new E.SUBMITTER_NOT_APPROVED(userSession.accountId);
        }
        const approval = await ppApprovalRepository.findByPpAndAccount(
          ppPublicKey,
          submitterAccount.id,
        );
        if (!approval || approval.status !== EntityStatus.APPROVED) {
          log.event("submitter entity not approved for this PP");
          throw new E.SUBMITTER_NOT_APPROVED(userSession.accountId);
        }
        // Identity (name / jurisdictions) still lives on the global entity
        // record; the per-PP approval above is the gate, but the bundle entry
        // wants the submitter's identity for downstream audit/labels.
        const submitterEntity = await entityRepository.findById(
          submitterAccount.entityId,
        );

        span.addEvent("generating_bundle_id");
        log.event("generating bundle ID");
        const bundleId = await generateBundleId(operationsMLXDR);
        span.setAttribute("bundle.id", bundleId);
        log.debug("bundleId", bundleId);
        const isBundleExpired = await assertBundleIsExpired(bundleId, deps);

        span.addEvent("parsing_and_classifying_operations");
        log.event("parsing and classifying operations");
        const operations = await parseOperations(operationsMLXDR, deps);
        const classified = classifyOperations(operations);
        validateSpendOperations(classified.spend);

        span.addEvent("operations_classified", {
          "operations.create": classified.create.length,
          "operations.spend": classified.spend.length,
          "operations.deposit": classified.deposit.length,
          "operations.withdraw": classified.withdraw.length,
        });

        span.addEvent("calculating_fee");
        log.event("calculating fee");
        const amounts = await calculateOperationAmounts(
          classified,
          channelClient,
          deps,
        );
        const feeCalculation = calculateFee(amounts);

        span.addEvent("fee_calculated", {
          "fee.amount": feeCalculation.fee.toString(),
          "fee.totalInflows": feeCalculation.totalInflows.toString(),
          "fee.totalOutflows": feeCalculation.totalOutflows.toString(),
        });
        log.debug("fee", feeCalculation.fee.toString());

        let bundleEntity: OperationsBundle;
        if (isBundleExpired) {
          span.addEvent("updating_expired_bundle");
          log.event("updating expired bundle");
          bundleEntity = await operationsBundleRepository.update(bundleId, {
            status: BundleStatus.PENDING,
            channelContractId,
            operationsMLXDR: operationsMLXDR,
            fee: feeCalculation.fee,
            retryCount: 0,
            ppPublicKey,
            updatedAt: new Date(),
            updatedBy: userSession.accountId,
          });
        } else {
          span.addEvent("creating_new_bundle");
          log.event("creating new bundle");
          bundleEntity = await operationsBundleRepository.create({
            id: bundleId,
            status: BundleStatus.PENDING,
            channelContractId,
            ttl: calculateBundleTtl(),
            operationsMLXDR: operationsMLXDR,
            fee: feeCalculation.fee,
            ppPublicKey,
            createdBy: userSession.accountId,
            createdAt: new Date(),
          });
        }

        if (feeCalculation.fee < BigInt(1)) {
          span.addEvent("zero_fee_warning");
          log.event("bundle has no fee");
        }

        span.addEvent("persisting_utxos");
        log.event("persisting UTXOs");
        await persistCreateOperations(
          classified.create,
          bundleEntity.id,
          userSession.accountId,
          deps,
        );
        await persistSpendOperations(
          classified.spend,
          bundleEntity.id,
          userSession.accountId,
          channelClient,
          deps,
        );

        span.addEvent("adding_to_mempool");
        log.event("adding to mempool");
        const slotBundle = createSlotBundle(
          bundleEntity,
          classified,
          submitterEntity?.name ?? null,
          submitterEntity?.jurisdictions ?? [],
        );
        const mempool = getMempool();
        await mempool.addBundle(slotBundle);

        span.addEvent("bundle_added_to_mempool", {
          "bundle.id": bundleEntity.id,
        });
        log.event("bundle added to mempool for asynchronous processing");

        return {
          ctx: input.ctx,
          operationsBundleId: bundleEntity.id,
        };
      });
    },
    {
      name: "ProcessNewBundleProcessEngine",
    },
  );
