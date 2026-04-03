import { ProcessEngine } from "@fifo/convee";
import { Buffer } from "buffer";
import type { JwtSessionData } from "@/http/middleware/auth/index.ts";
import { BundleStatus } from "@/persistence/drizzle/entity/operations-bundle.entity.ts";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { LOG } from "@/config/logger.ts";
import type { requestSchema } from "@/http/v1/bundle/post.ts";
import type { PostEndpointInput } from "@/http/pipelines/types.ts";
import type { OperationTypes } from "@moonlight/moonlight-sdk";
import { MoonlightOperation } from "@moonlight/moonlight-sdk";
import { getChannelClient } from "@/core/channel-client/index.ts";
import { resolveChannelContext } from "@/core/service/executor/channel-resolver.ts";
import {
  classifyOperations,
  calculateOperationAmounts,
  calculateFee,
  generateBundleId,
  calculateBundleTtl,
  calculateBundleWeight,
  calculatePriorityScore,
  fetchUtxoBalances,
} from "@/core/service/bundle/bundle.service.ts";
import { MEMPOOL_EXPENSIVE_OP_WEIGHT, MEMPOOL_CHEAP_OP_WEIGHT, BUNDLE_MAX_OPERATIONS } from "@/config/env.ts";
import type { SlotBundle, WeightConfig } from "@/core/service/bundle/bundle.types.ts";
import { getMempool } from "@/core/mempool/index.ts";
import * as E from "@/core/service/bundle/bundle.errors.ts";
import type { ClassifiedOperations } from "@/core/service/bundle/bundle.types.ts";
import { logAndThrow } from "@/utils/error/log-and-throw.ts";
import type { OperationsBundle } from "@/persistence/drizzle/entity/operations-bundle.entity.ts";
import {
  OperationsBundleRepository,
  SessionRepository,
  UtxoRepository,
} from "@/persistence/drizzle/repository/index.ts";
import { withSpan } from "@/core/tracing.ts";

// Repositories
const sessionRepository = new SessionRepository(drizzleClient);
const utxoRepository = new UtxoRepository(drizzleClient);
const operationsBundleRepository = new OperationsBundleRepository(drizzleClient);

// Mempool configuration
const MEMPOOL_WEIGHT_CONFIG: WeightConfig = {
  expensiveOpWeight: MEMPOOL_EXPENSIVE_OP_WEIGHT,
  cheapOpWeight: MEMPOOL_CHEAP_OP_WEIGHT,
} as const;

// ========== HELPER FUNCTIONS ==========

/**
 * Validates the user session
 */
async function validateSession(sessionId: string) {
  return withSpan("Bundle.validateSession", async (span) => {
    span.addEvent("looking_up_session", { "session.id": sessionId });
    const userSession = await sessionRepository.findById(sessionId);
    if (!userSession) {
      span.addEvent("session_not_found");
      logAndThrow(new E.INVALID_SESSION(sessionId));
    }
    span.addEvent("session_valid", { "account.id": userSession.accountId });
    return userSession;
  });
}

/**
 * Validates that a bundle with the given ID does not exist, or if it does, ensures it is expired.
 * Throws an error if an active bundle exists.
 */
async function assertBundleIsExpired(bundleId: string): Promise<boolean> {
  return withSpan("Bundle.assertBundleIsExpired", async (span) => {
    span.addEvent("checking_existing_bundle", { "bundle.id": bundleId });
    const existingBundle = await operationsBundleRepository.findById(bundleId);

    if (!existingBundle) {
      span.addEvent("bundle_not_found");
      return false;
    }

    if (
      existingBundle.status !== BundleStatus.EXPIRED &&
      existingBundle.status !== BundleStatus.FAILED
    ) {
      span.addEvent("bundle_exists_not_expired", { "bundle.status": existingBundle.status });
      logAndThrow(new E.BUNDLE_ALREADY_EXISTS(bundleId));
    }

    span.addEvent("bundle_can_be_reused", { "bundle.status": existingBundle.status });
    return true;
  });
}

/**
 * Parses MLXDR operations
 */
async function parseOperations(operationsMLXDR: string[]): Promise<Array<OperationTypes.CreateOperation | OperationTypes.SpendOperation | OperationTypes.DepositOperation | OperationTypes.WithdrawOperation>> {
  return withSpan("Bundle.parseOperations", async (span) => {
    span.addEvent("parsing_operations", { "operations.count": operationsMLXDR.length });
    const operations = await Promise.all(
      operationsMLXDR.map((xdr) => MoonlightOperation.fromMLXDR(xdr))
    );

    if (operations.length === 0) {
      span.addEvent("no_operations");
      logAndThrow(new E.NO_OPERATIONS_PROVIDED());
    }

    span.addEvent("operations_parsed", { "operations.count": operations.length });
    return operations;
  });
}

/**
 * Validates spend operations
 */
function validateSpendOperations(operations: OperationTypes.SpendOperation[]): void {
  for (let i = 0; i < operations.length; i++) {
    const operation = operations[i];
    if (!operation.isSignedByUTXO()) {
      logAndThrow(new E.SPEND_OPERATION_NOT_SIGNED(i));
    }
  }
}


/**
 * Persists UTXOs in the database from create operations
 */
async function persistCreateOperations(
  operations: OperationTypes.CreateOperation[],
  bundleId: string,
  accountId: string
): Promise<void> {
  return withSpan("Bundle.persistCreateOperations", async (span) => {
    span.addEvent("persisting_create_utxos", { "operations.count": operations.length, "bundle.id": bundleId });
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
  });
}

/**
 * Updates UTXOs in the database from spend operations
 *
 * Note: The spend amount is fetched directly from the network since
 * SpendOperation intentionally does not have an amount attribute.
 */
async function persistSpendOperations(
  operations: OperationTypes.SpendOperation[],
  bundleId: string,
  accountId: string,
  channelClient: import("@moonlight/moonlight-sdk").PrivacyChannel,
): Promise<void> {
  if (operations.length === 0) {
    return;
  }

  return withSpan("Bundle.persistSpendOperations", async (span) => {
    span.addEvent("persisting_spend_utxos", {
      "operations.count": operations.length,
      "bundle.id": bundleId,
    });

    // Fetch all UTXO balances from the network in batch for better performance.
    const utxoPublicKeys = operations.map((op) => op.getUtxo());
    const balances = await fetchUtxoBalances(utxoPublicKeys, channelClient);

    for (let i = 0; i < operations.length; i++) {
      const operation = operations[i];
      const utxoPublicKey = operation.getUtxo();
      // Convert UTXO public key to base64 string to match the format used in persistCreateOperations.
      const utxoId = Buffer.from(utxoPublicKey).toString("base64");

      const utxo = await utxoRepository.findById(utxoId);
      if (!utxo) {
        span.addEvent("utxo_not_found", { "utxo.id": utxoId });
        logAndThrow(new E.UTXO_NOT_FOUND(utxoId));
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

/**
 * Creates a SlotBundle from bundle data
 */
function createSlotBundle(
  bundleEntity: OperationsBundle,
  classified: ClassifiedOperations
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
  };
}

// ========== MAIN PROCESS ==========

export const P_AddOperationsBundle = ProcessEngine.create(
  async (input: PostEndpointInput<typeof requestSchema>) => {
    return withSpan("P_AddOperationsBundle", async (span) => {
      const { operationsMLXDR, channelContractId } = input.body;
      const sessionData = input.ctx.state.session as JwtSessionData;

      // Resolve channel client for on-chain reads (UTXO balances)
      const channelCtx = await resolveChannelContext(channelContractId);
      const channelClient = channelCtx.channelClient;

      // 1. Session validation
      span.addEvent("validating_session");
      const userSession = await validateSession(sessionData.sessionId);

      // 2. Bundle ID generation and validation
      span.addEvent("generating_bundle_id");
      const bundleId = await generateBundleId(operationsMLXDR);
      span.setAttribute("bundle.id", bundleId);
      const isBundleExpired = await assertBundleIsExpired(bundleId);

      // 3. Parse and classify operations
      span.addEvent("parsing_and_classifying_operations");
      const operations = await parseOperations(operationsMLXDR);
      if (operations.length > BUNDLE_MAX_OPERATIONS) {
        logAndThrow(new E.TOO_MANY_OPERATIONS(operations.length, BUNDLE_MAX_OPERATIONS));
      }
      const classified = classifyOperations(operations);
      validateSpendOperations(classified.spend);

      span.addEvent("operations_classified", {
        "operations.create": classified.create.length,
        "operations.spend": classified.spend.length,
        "operations.deposit": classified.deposit.length,
        "operations.withdraw": classified.withdraw.length,
      });

      // 4. Fee calculation
      span.addEvent("calculating_fee");
      const amounts = await calculateOperationAmounts(classified, channelClient);
      LOG.info("amounts: ", amounts);
      const feeCalculation = calculateFee(amounts);

      span.addEvent("fee_calculated", {
        "fee.amount": feeCalculation.fee.toString(),
        "fee.totalInflows": feeCalculation.totalInflows.toString(),
        "fee.totalOutflows": feeCalculation.totalOutflows.toString(),
      });

      // 5. Bundle update or creation
      let bundleEntity: OperationsBundle;
      if (isBundleExpired) {
        span.addEvent("updating_expired_bundle");
        bundleEntity = await operationsBundleRepository.update(bundleId, {
          status: BundleStatus.PENDING,
          channelContractId,
          operationsMLXDR: operationsMLXDR,
          fee: feeCalculation.fee,
          retryCount: 0,
          updatedAt: new Date(),
          updatedBy: userSession.accountId,
        });
      } else {
        span.addEvent("creating_new_bundle");
        bundleEntity = await operationsBundleRepository.create({
          id: bundleId,
          status: BundleStatus.PENDING,
          channelContractId,
          ttl: calculateBundleTtl(),
          operationsMLXDR: operationsMLXDR,
          fee: feeCalculation.fee,
          createdBy: userSession.accountId,
          createdAt: new Date(),
        });
      }

      if (feeCalculation.fee < BigInt(1)) {
        span.addEvent("zero_fee_warning");
        LOG.warn("This bundle doesn't have any fee");
      }

      // 6. Persist UTXOs
      span.addEvent("persisting_utxos");
      await persistCreateOperations(classified.create, bundleEntity.id, userSession.accountId);
      await persistSpendOperations(classified.spend, bundleEntity.id, userSession.accountId, channelClient);

      // 7. Create SlotBundle and add to Mempool
      span.addEvent("adding_to_mempool");
      const slotBundle = createSlotBundle(bundleEntity, classified);
      const mempool = getMempool();
      await mempool.addBundle(slotBundle);

      span.addEvent("bundle_added_to_mempool", { "bundle.id": bundleEntity.id });
      LOG.info(`Bundle ${bundleEntity.id} added to mempool for asynchronous processing`);

      return {
        ctx: input.ctx,
        operationsBundleId: bundleEntity.id,
      };
    });
  },
  {
    name: "ProcessNewBundleProcessEngine",
  }
);
