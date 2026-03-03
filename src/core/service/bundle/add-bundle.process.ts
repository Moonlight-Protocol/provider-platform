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
import {
  classifyOperations,
  calculateOperationAmounts,
  calculateFee,
  generateBundleId,
  calculateBundleTtl,
  calculateBundleWeight,
  calculatePriorityScore,
} from "@/core/service/bundle/bundle.service.ts";
import type { SlotBundle, WeightConfig } from "@/core/service/bundle/bundle.types.ts";
import { MEMPOOL_EXPENSIVE_OP_WEIGHT, MEMPOOL_CHEAP_OP_WEIGHT } from "@/config/env.ts";
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

// Configuration constants
const BUNDLE_CONFIG = {
  TTL_HOURS: 24,
} as const;

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
  const userSession = await sessionRepository.findById(sessionId);
  if (!userSession) {
    logAndThrow(new E.INVALID_SESSION(sessionId));
  }
  return userSession;
}

/**
 * Validates that a bundle with the given ID does not exist, or if it does, ensures it is expired.
 * Throws an error if an active bundle exists.
 */
async function assertBundleIsNotExpired(bundleId: string): Promise<boolean> {
  const existingBundle = await operationsBundleRepository.findById(bundleId);

  if (!existingBundle)
    return false;

  if (existingBundle.status !== BundleStatus.EXPIRED)
    logAndThrow(new E.BUNDLE_ALREADY_EXISTS(bundleId));
  
  return true;
}

/**
 * Parses MLXDR operations
 */
async function parseOperations(operationsMLXDR: string[]): Promise<Array<OperationTypes.CreateOperation | OperationTypes.SpendOperation | OperationTypes.DepositOperation | OperationTypes.WithdrawOperation>> {
  const operations = await Promise.all(
    operationsMLXDR.map((xdr) => MoonlightOperation.fromMLXDR(xdr))
  );
  
  if (operations.length === 0) {
    logAndThrow(new E.NO_OPERATIONS_PROVIDED());
  }
  
  return operations;
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
  for (const operation of operations) {
    const utxoId = Buffer.from(operation.getUtxo()).toString("base64");
    const utxo = await utxoRepository.findById(utxoId);
    if (utxo) {
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
}

/**
 * Updates UTXOs in the database from spend operations
 */
async function persistSpendOperations(
  operations: OperationTypes.SpendOperation[],
  bundleId: string,
  accountId: string
): Promise<void> {
  for (const operation of operations) {
    const utxoId = operation.getUtxo().toString();
    const utxo = await utxoRepository.findById(utxoId);
    
    if (!utxo) {
      logAndThrow(new E.UTXO_NOT_FOUND(utxoId));
    }
    
    await utxoRepository.update(utxo.id, {
      amount: utxo.amount - operation.getAmount(),
      updatedAt: new Date(),
      updatedBy: accountId,
      spentAtBundleId: bundleId,
      spentByAccountId: accountId,
    });
  }
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
    operationsMLXDR: bundleEntity.operationsMLXDR,
    operations: classified,
    fee: bundleEntity.fee,
    weight,
    ttl: bundleEntity.ttl,
    createdAt: bundleEntity.createdAt,
    priorityScore,
  };
}

// ========== MAIN PROCESS ==========

export const P_AddOperationsBundle = ProcessEngine.create(
  async (input: PostEndpointInput<typeof requestSchema>) => {
    const { operationsMLXDR } = input.body;
    const sessionData = input.ctx.state.session as JwtSessionData;

    // 1. Session validation
    const userSession = await validateSession(sessionData.sessionId);

    // 2. Bundle ID generation and validation
    const bundleId = await generateBundleId(operationsMLXDR);
    const isBundleExpired = await assertBundleIsNotExpired(bundleId);

    // 3. Parse and classify operations
    const operations = await parseOperations(operationsMLXDR);
    const classified = classifyOperations(operations);
    validateSpendOperations(classified.spend);
      
    // 4. Fee calculation
    const amounts = calculateOperationAmounts(classified);
    const feeCalculation = calculateFee(amounts);
      
    // 5. Bundle update or creation
    let bundleEntity: OperationsBundle;
    if (isBundleExpired) {
      bundleEntity = await operationsBundleRepository.update(bundleId, {
        status: BundleStatus.PENDING,
        operationsMLXDR: operationsMLXDR,
        fee: feeCalculation.fee,
        updatedAt: new Date(),
        updatedBy: userSession.accountId,
      });
    } else {
      bundleEntity = await operationsBundleRepository.create({
        id: bundleId,
        status: BundleStatus.PENDING,
        ttl: calculateBundleTtl(),
        operationsMLXDR: operationsMLXDR,
        fee: feeCalculation.fee,
        createdBy: userSession.accountId,
        createdAt: new Date(),
      });
    }
    
    LOG.debug("Fee calculation breakdown", {
      totalDepositAmount: feeCalculation.breakdown.totalDepositAmount.toString(),
      totalCreateAmount: feeCalculation.breakdown.totalCreateAmount.toString(),
      totalWithdrawAmount: feeCalculation.breakdown.totalWithdrawAmount.toString(),
      totalSpendAmount: feeCalculation.breakdown.totalSpendAmount.toString(),
      totalInflows: feeCalculation.totalInflows.toString(),
      totalOutflows: feeCalculation.totalOutflows.toString(),
      fee: feeCalculation.fee.toString(),
    });

    if (feeCalculation.fee < BigInt(1)) {
      LOG.warn("This bundle doesn't have any fee");
    }

    // 6. Persist UTXOs
    await persistCreateOperations(classified.create, bundleEntity.id, userSession.accountId);
    await persistSpendOperations(classified.spend, bundleEntity.id, userSession.accountId);

    // 7. Create SlotBundle and add to Mempool
    const slotBundle = createSlotBundle(bundleEntity, classified);
    const mempool = getMempool();
    await mempool.addBundle(slotBundle);

    LOG.info(`Bundle ${bundleEntity.id} added to mempool for asynchronous processing`);

    return {
      ctx: input.ctx,
      operationsBundleId: bundleEntity.id,
    };
  },
  {
    name: "ProcessNewBundleProcessEngine",
  }
);
